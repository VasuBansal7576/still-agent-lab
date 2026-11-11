import { randomUUID } from 'node:crypto';

const maxBytes = 1_000_000;
const allowedTools = ['get_order', 'cancel_order', 'refund_order', 'propose_fulfillment'];
const trialTools = ['get_order', 'get_dispute', 'refund_order'];

export function endpointUrl(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('Invalid external agent endpoint.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.hash) {
    throw new Error('External agent endpoint must be a loopback HTTP URL without credentials or a fragment.');
  }
  return url;
}

async function readLimited(response) {
  const length = Number(response.headers.get('content-length'));
  if (length > maxBytes) throw new Error('External agent response exceeded the limit.');
  if (!response.body) throw new Error('External agent returned an empty response.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('External agent response exceeded the limit.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('External agent returned invalid JSON.'); }
}

function parseAction(value, version) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.content !== 'string' || value.content.length > 5000 || !Object.hasOwn(value, 'tool')) {
    throw new Error('External agent returned an invalid action.');
  }
  const message = { role: 'assistant', content: value.content || null };
  if (value.tool === null) {
    if (!value.content.trim()) throw new Error('External agent returned an empty final response.');
    return message;
  }
  const tool = value.tool;
  if (!tool || typeof tool !== 'object' || Array.isArray(tool) || !(version === 2 ? trialTools : allowedTools).includes(tool.name) || !tool.arguments || typeof tool.arguments !== 'object' || Array.isArray(tool.arguments)) {
    throw new Error('External agent returned an invalid tool proposal.');
  }
  const keys = Object.keys(tool.arguments);
  const refundKeys = version === 2 ? ['amount', 'currency', 'requestId', 'orderId', 'customerId', 'captureId'] : ['amount', 'currency'];
  if (tool.name !== 'refund_order' ? keys.length !== 0 : keys.some(key => !refundKeys.includes(key) || typeof tool.arguments[key] !== 'string' || tool.arguments[key].length > 100) || (version === 1 && (keys.length !== 2 || !keys.includes('amount') || !keys.includes('currency')))) {
    throw new Error('External agent returned invalid tool arguments.');
  }
  message.tool_calls = [{ id: randomUUID(), type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }];
  return message;
}

export async function externalAgentChat({ endpoint, messages, version = 1 } = {}) {
  const url = endpointUrl(endpoint);
  if (![1, 2].includes(version)) throw new Error('Unsupported external agent protocol version.');
  if (!Array.isArray(messages) || !messages.length) throw new Error('A conversation is required.');
  const body = JSON.stringify({ version, messages, tools: version === 2 ? trialTools : allowedTools });
  if (Buffer.byteLength(body) > maxBytes) throw new Error('External agent request exceeded the limit.');
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body, redirect: 'error', signal: AbortSignal.timeout(60000) });
  } catch { throw new Error('External agent request failed or timed out.'); }
  if (!response.ok) throw new Error(`External agent returned HTTP ${response.status}.`);
  return parseAction(await readLimited(response), version);
}
