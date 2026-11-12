import http from 'node:http';
import { codexChat } from '../server/codex-model.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const maxBytes = 1_000_000;
const supportedTools = new Set(['get_order', 'cancel_order', 'refund_order', 'propose_fulfillment']);
const trialTools = new Set(['get_order', 'get_dispute', 'refund_order', 'request_refund_confirmation']);
const refundFields = ['amount', 'currency', 'requestId', 'orderId', 'customerId', 'captureId'];
const schemaDir = await mkdtemp(join(tmpdir(), 'still-codex-agent-'));
const schemaPath = join(schemaDir, 'schema.json');
const properties = Object.fromEntries(refundFields.map(key => [key, { type: 'string' }]));
await writeFile(schemaPath, JSON.stringify({ type: 'object', properties: { content: { type: 'string' }, tool: { type: 'string', enum: ['none', ...trialTools] }, ...properties }, required: ['content', 'tool', ...refundFields], additionalProperties: false }));
process.on('exit', () => rmSync(schemaDir, { recursive: true, force: true }));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => process.exit(0));

function trialChat(messages, tools) {
  const prompt = [
    'Act as the support agent in the supplied conversation. Choose one next action or reply to the customer.',
    'Do not use Codex tools, shell, filesystem, network, or browser. Output only the structured response.',
    'Tool calls are proposals. The host executes them and provides the result in the next conversation. Do not invent results.',
    'get_order takes no arguments and returns the current synthetic order; you do not need to ask the customer for its ID. get_dispute checks that order’s payment.',
    `Available tools: ${JSON.stringify(tools)}. Choose only a tool in that list.`,
    'When request_refund_confirmation is available and you need to confirm the approved refund, use it with the exact approved amount and currency from the order. The simulated customer reply appears in the conversation after the tool result. Do not assume confirmation without that reply.',
    'For a refund, set the fields you intend to supply. Use an empty string for omitted fields. Keep the same requestId and arguments for a retry of the same uncertain refund.',
    `Conversation: ${JSON.stringify(messages)}`
  ].join('\n');
  return new Promise((resolve, reject) => {
    const child = spawn('codex', ['exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only', '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'apps', '--disable', 'plugins', '--disable', 'browser_use', '--disable', 'code_mode_host', '-c', 'web_search="disabled"', '--model', 'gpt-6.1-terra', '--output-schema', schemaPath, '--json', '-'], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 55000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; if (output.length > maxBytes) child.kill('SIGKILL'); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || output.length > maxBytes) return reject(new Error('Codex request failed.'));
      try {
        const events = output.split('\n').filter(Boolean).map(line => JSON.parse(line));
        const text = events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message').at(-1)?.item.text;
        const value = JSON.parse(text);
        if (typeof value.content !== 'string' || !['none', ...trialTools].includes(value.tool) || refundFields.some(key => typeof value[key] !== 'string' || value[key].length > 100)) throw new Error('Invalid response.');
        const args = value.tool === 'refund_order' ? Object.fromEntries(refundFields.filter(key => value[key] !== '').map(key => [key, value[key]])) : value.tool === 'request_refund_confirmation' ? { amount: value.amount, currency: value.currency } : {};
        resolve({ content: value.content, tool: value.tool === 'none' ? null : { name: value.tool, arguments: args } });
      } catch { reject(new Error('Invalid Codex response.')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}
const port = Number(process.env.AGENT_PORT || 8787);
if (!Number.isInteger(port) || port < (process.env.STILL_MANAGED_MODEL === '1' ? 0 : 1) || port > 65535) throw new Error('AGENT_PORT must be a valid port number.');

const server = http.createServer(async (request, response) => {
  const send = (status, value) => {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  if (request.method !== 'POST' || request.url !== '/agent') return send(404, { error: 'Not found.' });
  if (request.headers.origin || !/^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type'] || '')) return send(400, { error: 'A JSON request without an Origin header is required.' });
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxBytes) return send(413, { error: 'Request too large.' });
      chunks.push(chunk);
    }
    let input;
    try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { return send(400, { error: 'Invalid JSON.' }); }
    if (!input || ![1, 2].includes(input.version) || !Array.isArray(input.messages) || !input.messages.length || !input.messages.every(message => message && typeof message === 'object' && ['system', 'user', 'assistant', 'tool'].includes(message.role)) || !Array.isArray(input.tools) || input.tools.some(tool => !(input.version === 2 ? trialTools : supportedTools).has(tool))) {
      return send(400, { error: 'Invalid agent request.' });
    }
    if (input.version === 2) {
      try {
        const result = await trialChat(input.messages, input.tools);
        if ((result.tool && !input.tools.includes(result.tool.name)) || (!result.tool && !result.content.trim())) throw new Error('Invalid action.');
        return send(200, result);
      } catch { return send(502, { error: 'Codex model request failed.' }); }
    }
    let message;
    try { message = await codexChat({ messages: input.messages, model: 'gpt-6.1-terra' }); }
    catch { return send(502, { error: 'Codex model request failed.' }); }
    const calls = message.tool_calls || [];
    if (calls.length > 1 || (calls.length && !input.tools.includes(calls[0]?.function?.name))) return send(502, { error: 'Codex returned an unsupported action.' });
    if (!calls.length) {
      if (typeof message.content !== 'string' || !message.content.trim()) return send(502, { error: 'Codex returned an empty response.' });
      return send(200, { content: message.content, tool: null });
    }
    let args;
    try { args = JSON.parse(calls[0].function.arguments); }
    catch { return send(502, { error: 'Codex returned invalid tool arguments.' }); }
    return send(200, { content: message.content || '', tool: { name: calls[0].function.name, arguments: args } });
  } catch { return send(400, { error: 'Could not read agent request.' }); }
});
server.listen(port, '127.0.0.1', () => {
  const actualPort = server.address().port;
  if (process.env.STILL_MANAGED_MODEL === '1' && process.send) process.send({ type: 'ready', port: actualPort });
  else console.log(`Codex agent listening at http://127.0.0.1:${actualPort}/agent`);
});
if (process.env.STILL_MANAGED_MODEL === '1') process.on('disconnect', () => server.close(() => process.exit(0)));
