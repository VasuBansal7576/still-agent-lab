import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createStillToolkitAdapter } from './toolkit-openai-adapter.mjs';

const install = process.env.STILL_TOOLKIT_INSTALL;
if (!install) throw new Error('Set STILL_TOOLKIT_INSTALL to the directory containing node_modules.');
const require = createRequire(resolve(install, 'package.json'));
const { PayPalAgentToolkit } = require('@paypal/agent-toolkit/openai');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const toolkit = new PayPalAgentToolkit({ clientId: 'unused', clientSecret: 'unused', configuration: { actions: { disputes: { get: true }, payments: { createRefund: true } }, context: { sandbox: true } } });
const client = new Client({ name: 'still-toolkit-model', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../server/toolkit-mcp.mjs', import.meta.url)), '--demo'] });
const dir = await mkdtemp(join(tmpdir(), 'still-toolkit-model-'));
const schema = join(dir, 'schema.json');
await writeFile(schema, JSON.stringify({ type: 'object', properties: { tool: { type: 'string', enum: ['get_dispute', 'create_refund', 'none'] }, arguments: { type: 'string' }, content: { type: 'string' } }, required: ['tool', 'arguments', 'content'], additionalProperties: false }));
function decide(tools, messages) {
  const prompt = `You are a support agent. Choose one next action using the supplied tool definitions and conversation. Tool calls are proposals executed by the host; do not invent results. Output arguments as a JSON object encoded in a string. Use none when finished. Do not use Codex tools.\nTool definitions: ${JSON.stringify(tools)}\nConversation: ${JSON.stringify(messages)}`;
  return new Promise((resolveDecision, reject) => {
    const child = spawn('codex', ['exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only', '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'apps', '--disable', 'plugins', '--disable', 'browser_use', '--disable', 'code_mode_host', '--model', 'gpt-6.1-terra', '--output-schema', schema, '--json', '-'], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 1000000) child.kill('SIGKILL'); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('Codex request failed.'));
      try {
        const events = output.split('\n').filter(Boolean).map(line => JSON.parse(line));
        resolveDecision(JSON.parse(events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message').at(-1).item.text));
      } catch { reject(new Error('Invalid Codex response.')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}
try {
  await client.connect(transport);
  const adapter = await createStillToolkitAdapter({ toolkit, client });
  const messages = [{ role: 'user', content: 'Check dispute demo-dispute, then refund USD 50.00 on capture MOCK-CAPTURE-toolkit if clear. Report the outcome.' }];
  const observed = [];
  let finished = false;
  for (let turn = 0; turn < 6; turn++) {
    const decision = await decide(adapter.tools, messages);
    console.log(JSON.stringify({ model: 'gpt-6.1-terra', decision }));
    if (decision.tool === 'none') { finished = true; break; }
    const call = { id: randomUUID(), type: 'function', function: { name: decision.tool, arguments: decision.arguments } };
    messages.push({ role: 'assistant', content: decision.content || null, tool_calls: [call] });
    const [reply] = await adapter.dispatch([call]);
    messages.push(reply);
    console.log(JSON.stringify({ gateway: JSON.parse(reply.content) }));
    observed.push({ name: decision.tool, result: JSON.parse(reply.content) });
  }
  const dispute = observed.find(item => item.name === 'get_dispute' && !item.result.error);
  const refund = observed.find(item => item.name === 'create_refund' && !item.result.error);
  if (!finished || !dispute || !refund || observed.indexOf(dispute) >= observed.indexOf(refund)) throw new Error('Model did not complete the ordered gateway journey.');
  if (dispute.result.status !== 'CLEAR' || refund.result.status !== 'COMPLETED' || refund.result.id !== 'MOCK-REFUND-toolkit-1') throw new Error('Gateway results did not match the expected mock journey.');
  console.log(JSON.stringify({ outcome: 'mock journey passed', calls: observed.map(item => item.name) }));
} finally {
  await client.close();
  await rm(dir, { recursive: true, force: true });
}
