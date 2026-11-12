import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStillToolkitAdapter } from './toolkit-openai-adapter.mjs';

const install = process.env.STILL_TOOLKIT_INSTALL;
const batchId = process.argv[2];
if (!install || !batchId) throw new Error('Set STILL_TOOLKIT_INSTALL and provide a passing batch UUID.');
const require = createRequire(resolve(install, 'package.json'));
const { PayPalAgentToolkit } = require('@paypal/agent-toolkit/openai');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const toolkit = new PayPalAgentToolkit({ clientId: 'unused', clientSecret: 'unused', configuration: { actions: { orders: { get: true }, disputes: { get: true }, payments: { createRefund: true } }, context: { sandbox: true } } });
const client = new Client({ name: 'still-sandbox-toolkit-journey', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../server/mcp-sandbox-scenario.mjs', import.meta.url)), batchId] });
await client.connect(transport);
try {
  const adapter = await createStillToolkitAdapter({ toolkit, client });
  const call = async (id, name, args) => JSON.parse((await adapter.dispatch([{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }]))[0].content);
  const order = await call('order', 'get_order', { id: 'sandbox-order' });
  if (order.source !== 'paypal-sandbox' || order.status !== 'COMPLETED' || typeof order.capture_id !== 'string') throw new Error('PayPal did not confirm the sandbox capture.');
  const dispute = await call('dispute', 'get_dispute', { dispute_id: 'sandbox-dispute' });
  if (dispute.status !== 'UNVERIFIED') throw new Error('The sandbox dispute observation was not returned.');
  const refund = await call('refund', 'create_refund', { capture_id: order.capture_id, amount: { value: '1.00', currency_code: 'USD' } });
  if (!refund.id || !['COMPLETED', 'PENDING'].includes(refund.status) || refund.amount?.value !== '1.00' || refund.amount?.currency_code !== 'USD') throw new Error('The sandbox refund response was not confirmed.');
  const repeat = await call('repeat', 'create_refund', { capture_id: order.capture_id, amount: { value: '1.00', currency_code: 'USD' } });
  if (repeat.error?.type !== 'still_gateway_error') throw new Error('The gateway did not block a second refund attempt.');
  console.log(JSON.stringify({ source: 'paypal-sandbox', funding: 'sandbox-test-card', storeFacts: 'synthetic', tools: adapter.tools.map(tool => tool.function.name), order, dispute, refund, repeat, result: refund.status === 'COMPLETED' ? 'completed' : 'pending-unverified', note: 'A sandbox pending refund is not a completed refund. External refund history and absence of disputes are not established.' }));
} finally { await client.close(); }
