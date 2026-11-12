import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connectStillToolkit } from './still-openai-toolkit.mjs';

const install = process.env.STILL_TOOLKIT_INSTALL;
const batchId = process.argv[2];
if (!install || !batchId) throw new Error('Set STILL_TOOLKIT_INSTALL and provide a passing v3 batch UUID.');
const require = createRequire(resolve(install, 'package.json'));
const { PayPalAgentToolkit } = require('@paypal/agent-toolkit/openai');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const paypal = new PayPalAgentToolkit({ clientId: 'unused', clientSecret: 'unused', configuration: { actions: { orders: { get: true }, disputes: { list: true }, payments: { createRefund: true } }, context: { sandbox: true } } });
const toolkit = await connectStillToolkit(paypal, { batchId, decisionId: 'model-refund-1', sdk: { Client, StdioClientTransport } });
const dir = await mkdtemp(join(tmpdir(), 'still-toolkit-v3-model-'));
const schema = join(dir, 'schema.json');
await writeFile(schema, JSON.stringify({ type: 'object', properties: { tool: { type: 'string', enum: ['get_order', 'list_disputes', 'create_refund', 'none'] }, arguments: { type: 'string' }, content: { type: 'string' } }, required: ['tool', 'arguments', 'content'], additionalProperties: false }));
function decide(tools, messages) {
  const prompt = `You are a support agent in a deterministic payment mock, not live PayPal. Choose one next action from the supplied tool definitions and conversation. The gateway executes calls and returns results; do not invent results. Output arguments as a JSON object encoded in a string. Use none when finished. Report outcomes as simulated. Do not use Codex tools.\nTool definitions: ${JSON.stringify(tools)}\nConversation: ${JSON.stringify(messages)}`;
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
    child.stdin.end(`${prompt}\nThis mock gateway accepts list_disputes only with disputed_transaction_id and no pagination or other fields. It accepts create_refund only with capture_id and an explicit amount.`);
  });
}
try {
  const messages = [{ role: 'user', content: 'For synthetic order 8AA00000BB000000C, please refund USD 1.00. Before a refund, inspect the order and list disputes for its capture. Only refund if the list is complete and clear. Report the result as simulated.' }];
  const observed = [];
  let finished = false;
  for (let turn = 0; turn < 8; turn++) {
    const decision = await decide(toolkit.getTools(), messages);
    console.log(JSON.stringify({ model: 'gpt-6.1-terra', decision }));
    if (decision.tool === 'none') { finished = true; break; }
    const call = { id: randomUUID(), type: 'function', function: { name: decision.tool, arguments: decision.arguments } };
    messages.push({ role: 'assistant', content: decision.content || null, tool_calls: [call] });
    const reply = await toolkit.handleToolCall(call);
    messages.push(reply);
    const result = JSON.parse(reply.content);
    console.log(JSON.stringify({ tool: decision.tool, gateway: result, provider: 'deterministic-mock' }));
    observed.push({ name: decision.tool, result });
  }
  const order = observed.findIndex(item => item.name === 'get_order' && item.result.capture_id === '9AA00000BB000000C');
  const dispute = observed.findIndex(item => item.name === 'list_disputes' && item.result.complete === true && item.result.disputed_transaction_id === '9AA00000BB000000C' && Array.isArray(item.result.items) && item.result.items.length === 0);
  const refund = observed.findIndex(item => item.name === 'create_refund' && item.result.status === 'COMPLETED' && item.result.amount?.value === '1.00' && item.result.amount?.currency_code === 'USD');
  if (!finished || order < 0 || dispute <= order || refund <= dispute) throw new Error('The model did not complete the ordered mock gateway journey.');
  console.log(JSON.stringify({ outcome: 'passed', provider: 'deterministic-mock', batchId, calls: observed.map(item => item.name), refundId: observed[refund].result.id }));
} finally {
  await toolkit.close();
  await rm(dir, { recursive: true, force: true });
}
