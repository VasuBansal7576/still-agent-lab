import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { connectStillToolkit } from './still-openai-toolkit.mjs';

const install = process.env.STILL_TOOLKIT_INSTALL;
const batchId = process.argv[2];
if (!install || !batchId) throw new Error('Set STILL_TOOLKIT_INSTALL and provide a passing v3 batch UUID.');
const require = createRequire(resolve(install, 'package.json'));
const { PayPalAgentToolkit } = require('@paypal/agent-toolkit/openai');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const paypal = new PayPalAgentToolkit({ clientId: 'unused', clientSecret: 'unused', configuration: { actions: { orders: { get: true }, disputes: { list: true }, payments: { createRefund: true } }, context: { sandbox: true } } });
const toolkit = await connectStillToolkit(paypal, { batchId, decisionId: 'example-refund-1', sdk: { Client, StdioClientTransport } });
try {
  const call = async (id, name, args) => {
    const message = await toolkit.handleToolCall({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
    const body = JSON.parse(message.content);
    console.log(JSON.stringify({ id, name, body, provider: 'deterministic-mock' }));
    return body;
  };
  console.log(JSON.stringify({ tools: toolkit.getTools().map(tool => tool.function.name), source: 'actual PayPal Agent Toolkit definitions' }));
  const order = await call('order', 'get_order', { id: '8AA00000BB000000C' });
  const refund = { capture_id: order.capture_id, amount: { value: '1.00', currency_code: 'USD' } };
  const unchecked = await call('unchecked', 'create_refund', refund);
  const wrongList = await call('wrong-list', 'list_disputes', { disputed_transaction_id: '7AA00000BB000000C' });
  const stillUnchecked = await call('still-unchecked', 'create_refund', refund);
  const list = await call('list', 'list_disputes', { disputed_transaction_id: order.capture_id });
  const over = await call('over', 'create_refund', { ...refund, amount: { value: '9999999.00', currency_code: 'USD' } });
  const first = await call('refund', 'create_refund', refund);
  const retry = await call('retry', 'create_refund', refund);
  const unsupported = await call('unsupported', 'create_refund', { ...refund, invoice_id: 'unsupported' });
  if (!unchecked.error || !wrongList.error || !stillUnchecked.error || !list.complete || list.items.length || !over.error || first.status !== 'COMPLETED' || first.id !== retry.id || !unsupported.error) throw new Error('The v3 mock gateway journey did not complete.');
  console.log(JSON.stringify({ outcome: 'passed', provider: 'deterministic-mock', refundId: first.id }));
} finally { await toolkit.close(); }
