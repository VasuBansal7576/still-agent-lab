import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createGateway } from './gateway.mjs';
import { createDemoBinding } from './toolkit-demo.mjs';

export const toolkitTools = [
  { name: 'get_order', description: 'Retrieve an order.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'get_refund', description: 'Retrieve a refund.', inputSchema: { type: 'object', properties: { refund_id: { type: 'string' } }, required: ['refund_id'] } },
  { name: 'get_dispute', description: 'Retrieve a dispute.', inputSchema: { type: 'object', properties: { dispute_id: { type: 'string' } }, required: ['dispute_id'] } },
  { name: 'list_disputes', description: 'List disputes for one capture. Only complete, unfiltered mock listings are supported.', inputSchema: { type: 'object', properties: { disputed_transaction_id: { type: 'string' } }, required: ['disputed_transaction_id'], additionalProperties: false } },
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
        if (!toolkitTools.some(tool => tool.name === message.params?.name)) return response({ content: [{ type: 'text', text: 'Tool is not supported.' }], isError: true });
        const name = message.params?.name;
        let args = message.params?.arguments;
        if (name === 'get_order' && args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 1 && Object.hasOwn(args, 'id')) args = { order_id: args.id };
        const result = await gateway.call({ sessionId, decisionId, name, arguments: args });
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
  if (process.argv.slice(2).some(arg => arg !== '--demo') || process.argv.slice(2).length > 1) throw new Error('Supported option: --demo');
  const binding = process.argv[2] === '--demo'
    ? await createDemoBinding()
    : { gateway: createGateway({ agentId: 'unbound', adapter }), sessionId: 'stdio' };
  const handle = createMcpHandler(binding);
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
