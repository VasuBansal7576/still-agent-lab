import http from 'node:http';
import { codexChat } from '../server/codex-model.mjs';

const maxBytes = 1_000_000;
const supportedTools = new Set(['get_order', 'refund_order', 'propose_fulfillment']);
const port = Number(process.env.AGENT_PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('AGENT_PORT must be a valid port number.');

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
    if (!input || input.version !== 1 || !Array.isArray(input.messages) || !input.messages.length || !input.messages.every(message => message && typeof message === 'object' && ['system', 'user', 'assistant', 'tool'].includes(message.role)) || !Array.isArray(input.tools) || input.tools.some(tool => !supportedTools.has(tool))) {
      return send(400, { error: 'Invalid agent request.' });
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
server.listen(port, '127.0.0.1', () => console.log(`Codex agent listening at http://127.0.0.1:${port}/agent`));
