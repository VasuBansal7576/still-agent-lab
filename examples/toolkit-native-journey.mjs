import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { connectStillToolkit } from './still-openai-toolkit.mjs';

const install = process.env.STILL_TOOLKIT_INSTALL;
const batchId = process.argv[2];
if (!install || !batchId) throw new Error('Set STILL_TOOLKIT_INSTALL and provide a passing batch UUID.');
const require = createRequire(resolve(install, 'package.json'));
const { PayPalAgentToolkit } = require('@paypal/agent-toolkit/openai');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const paypal = new PayPalAgentToolkit({ clientId: 'unused', clientSecret: 'unused', configuration: { actions: { disputes: { get: true }, payments: { createRefund: true } }, context: { sandbox: true } } });
const toolkit = await connectStillToolkit(paypal, { batchId, sdk: { Client, StdioClientTransport } });
try {
  const calls = [
    { id: 'check', type: 'function', function: { name: 'get_dispute', arguments: JSON.stringify({ dispute_id: 'batch-dispute' }) } },
    { id: 'refund', type: 'function', function: { name: 'create_refund', arguments: JSON.stringify({ capture_id: 'MOCK-CAPTURE-batch', amount: { value: '1.00', currency_code: 'USD' } }) } },
    { id: 'retry', type: 'function', function: { name: 'create_refund', arguments: JSON.stringify({ capture_id: 'MOCK-CAPTURE-batch', amount: { value: '1.00', currency_code: 'USD' } }) } }
  ];
  console.log(JSON.stringify({ tools: toolkit.getTools().map(tool => tool.function.name), source: 'actual PayPal Agent Toolkit definitions' }));
  const results = [];
  for (const call of calls) {
    const message = await toolkit.handleToolCall(call);
    const content = JSON.parse(message.content);
    const value = JSON.parse(content.content[0].text);
    results.push(value);
    console.log(JSON.stringify({ name: call.function.name, message, provider: 'deterministic-mock' }));
  }
  if (results[0].body?.status !== 'CLEAR' || results[1].status !== 201 || results[1].body?.id !== results[2].body?.id) throw new Error('The mock gateway journey did not complete.');
  console.log(JSON.stringify({ outcome: 'passed', provider: 'deterministic-mock', refundId: results[1].body.id }));
} finally {
  await toolkit.close();
}
