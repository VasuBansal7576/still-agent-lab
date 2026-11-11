import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createGateway } from './gateway.mjs';

export const toolkitTools = [
  { name: 'get_order', description: 'Retrieve an order.', inputSchema: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'] } },
  { name: 'get_refund', description: 'Retrieve a refund.', inputSchema: { type: 'object', properties: { refund_id: { type: 'string' } }, required: ['refund_id'] } },
  { name: 'get_dispute', description: 'Retrieve a dispute.', inputSchema: { type: 'object', properties: { dispute_id: { type: 'string' } }, required: ['dispute_id'] } },
  { name: 'create_refund', description: 'Request a refund for a captured payment. Still requires an explicit amount and currency.', inputSchema: { type: 'object', properties: { capture_id: { type: 'string' }, amount: { type: 'object', properties: { value: { type: 'string' }, currency_code: { type: 'string' } }, required: ['value', 'currency_code'] }, invoice_id: { type: 'string' }, note_to_payer: { type: 'string' } }, required: ['capture_id'] } }
];

export function createMcpHandler({ gateway, sessionId, decisionId } = {}) {
  if (!gateway || !sessionId) throw new Error('Gateway and session ID are required.');
  return async message => {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
    if (message.id === undefined) return null;
    const response = result => ({ jsonrpc: '2.0', id: message.id, result });
    if (message.method === 'initialize') return response({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'still-toolkit-gateway', version: '0.1.0' } });
    if (message.method === 'ping') return response({});
    if (message.method === 'tools/list') return response({ tools: toolkitTools });
    if (message.method === 'tools/call') {
      try {
        const result = await gateway.call({ sessionId, decisionId, name: message.params?.name, arguments: message.params?.arguments });
        return response({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: result.ok === false });
      } catch {
        return response({ content: [{ type: 'text', text: 'Gateway call failed.' }], isError: true });
      }
    }
    return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const adapter = {
    async inspect() { throw new Error('No account bound'); },
    async refund() { throw new Error('No account bound'); }
  };
  const gateway = createGateway({ agentId: 'unbound', adapter });
  const handle = createMcpHandler({ gateway, sessionId: 'stdio' });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let queue = Promise.resolve();
  lines.on('line', line => {
    queue = queue.then(async () => {
      let message;
      try { message = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); return; }
      const response = await handle(message);
      if (response) process.stdout.write(JSON.stringify(response) + '\n');
    });
  });
}
