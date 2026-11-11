import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connectStillToolkit } from './still-openai-toolkit.mjs';

const install = process.env.STILL_TOOLKIT_INSTALL;
if (!install) throw new Error('Set STILL_TOOLKIT_INSTALL to the directory containing node_modules.');
const require = createRequire(resolve(install, 'package.json'));
const { PayPalAgentToolkit } = require('@paypal/agent-toolkit/openai');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const paypalToolkit = new PayPalAgentToolkit({ clientId: 'unused', clientSecret: 'unused', configuration: { actions: { disputes: { get: true }, payments: { createRefund: true } }, context: { sandbox: true } } });
const toolkit = await connectStillToolkit(paypalToolkit, { batchId: process.argv[2], sdk: { Client, StdioClientTransport } });
const dir = await mkdtemp(join(tmpdir(), 'still-toolkit-model-'));
const schema = join(dir, 'schema.json');
await writeFile(schema, JSON.stringify({ type: 'object', properties: { tool: { type: 'string', enum: ['get_dispute', 'create_refund', 'none'] }, arguments: { type: 'string' }, content: { type: 'string' } }, required: ['tool', 'arguments', 'content'], additionalProperties: false }));
function decide(tools, messages) {
  const prompt = `You are a support agent in a deterministic payment mock, not live PayPal. State clearly that all outcomes are simulated. Choose one next action using the supplied tool definitions and conversation. Tool calls are proposals executed by the host; do not invent results. Output arguments as a JSON object encoded in a string. Use none when finished. Do not use Codex tools.\nTool definitions: ${JSON.stringify(tools)}\nConversation: ${JSON.stringify(messages)}`;
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
  const messages = [{ role: 'user', content: 'Using the simulated payment mock, check dispute batch-dispute, then refund USD 50.00 on capture MOCK-CAPTURE-batch if clear. Report the outcome as simulated.' }];
  const observed = [];
  let finished = false;
  for (let turn = 0; turn < 6; turn++) {
    const decision = await decide(toolkit.getTools(), messages);
    console.log(JSON.stringify({ model: 'gpt-6.1-terra', decision }));
    if (decision.tool === 'none') { finished = true; break; }
    const call = { id: randomUUID(), type: 'function', function: { name: decision.tool, arguments: decision.arguments } };
    messages.push({ role: 'assistant', content: decision.content || null, tool_calls: [call] });
    const reply = await toolkit.handleToolCall(call);
    messages.push(reply);
    console.log(JSON.stringify({ gateway: JSON.parse(reply.content) }));
    observed.push({ name: decision.tool, result: JSON.parse(reply.content) });
  }
  const dispute = observed.find(item => item.name === 'get_dispute' && !item.result.isError);
  const refund = observed.find(item => item.name === 'create_refund' && !item.result.isError);
  if (!finished || !dispute || !refund || observed.indexOf(dispute) >= observed.indexOf(refund)) throw new Error('Model did not complete the ordered gateway journey.');
  const disputeBody = JSON.parse(dispute.result.content[0].text);
  const refundBody = JSON.parse(refund.result.content[0].text);
  if (disputeBody.body.status !== 'CLEAR' || refundBody.status !== 201 || refundBody.body.id !== 'MOCK-REFUND-batch-1') throw new Error('Gateway results did not match the expected mock journey.');
  console.log(JSON.stringify({ outcome: 'mock journey passed', calls: observed.map(item => item.name) }));
} finally {
  await toolkit.close();
  await rm(dir, { recursive: true, force: true });
}
