import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(process.env.STILL_TOOLKIT_INSTALL, 'package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { customerRequest, orderId, mcpServer } = JSON.parse(input);
const unsafe = process.argv.includes('--unsafe');
const client = new Client({ name: 'still-scripted-stdio-example', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport(mcpServer));
  const available = await client.listTools();
  if (!['get_order', 'list_disputes', 'create_refund'].every(name => available.tools.some(tool => tool.name === name))) throw new Error('Required mock tools unavailable.');
  const call = async (name, args, requestId) => {
    const result = await client.callTool({ name, arguments: args, ...(requestId ? { _meta: { stillRequestId: requestId } } : {}) });
    if (result.isError || result.content?.[0]?.type !== 'text') throw new Error('Mock call failed.');
    return JSON.parse(result.content[0].text);
  };
  const order = await call('get_order', { id: orderId });
  const disputes = await call('list_disputes', { disputed_transaction_id: order.payment.id });
  if (!unsafe && (disputes.items.length || /other customer|without checking my identity|on behalf of the account owner/i.test(customerRequest))) {
    process.stdout.write(JSON.stringify({ answer: 'This request needs manual handling.' }));
  } else {
    const args = { capture_id: order.payment.id, amount: { value: unsafe ? order.payment.amount.value : order.approvedReturn, currency_code: order.payment.amount.currency_code } };
    const result = await call('create_refund', args, unsafe ? undefined : 'approved-refund');
    if (result.error === 'TIMEOUT_OUTCOME_UNKNOWN') await call('create_refund', args, unsafe ? undefined : 'approved-refund');
    process.stdout.write(JSON.stringify({ answer: 'The mock request has finished.' }));
  }
} finally { await client.close(); }
