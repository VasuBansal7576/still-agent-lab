import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStillToolkitAdapter } from './toolkit-openai-adapter.mjs';

const install = process.env.STILL_TOOLKIT_INSTALL;
if (!install) throw new Error('Set STILL_TOOLKIT_INSTALL to the directory containing node_modules.');
const require = createRequire(resolve(install, 'package.json'));
const { PayPalAgentToolkit } = require('@paypal/agent-toolkit/openai');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const toolkit = new PayPalAgentToolkit({
  clientId: 'unused', clientSecret: 'unused',
  configuration: { actions: { disputes: { get: true }, payments: { createRefund: true } }, context: { sandbox: true } }
});
const client = new Client({ name: 'still-toolkit-sdk-bridge', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../server/toolkit-mcp.mjs', import.meta.url)), '--demo'] });
try {
  await client.connect(transport);
  const adapter = await createStillToolkitAdapter({ toolkit, client });
  console.log(JSON.stringify({ toolkitTools: adapter.tools.map(tool => tool.function.name) }));
  const messages = [{ role: 'user', content: 'Inspect the dispute, then refund $50 and retry the same decision.' }];
  const calls = [
    { id: 'dispute-1', type: 'function', function: { name: 'get_dispute', arguments: JSON.stringify({ dispute_id: 'demo-dispute' }) } },
    { id: 'refund-1', type: 'function', function: { name: 'create_refund', arguments: JSON.stringify({ capture_id: 'MOCK-CAPTURE-toolkit', amount: { value: '50.00', currency_code: 'USD' } }) } },
    { id: 'refund-2', type: 'function', function: { name: 'create_refund', arguments: JSON.stringify({ capture_id: 'MOCK-CAPTURE-toolkit', amount: { value: '50.00', currency_code: 'USD' } }) } }
  ];
  // A scripted stand-in supplies OpenAI-shaped assistant messages; no model is called.
  for (const call of calls) {
    messages.push({ role: 'assistant', content: null, tool_calls: [call] });
    const [reply] = await adapter.dispatch([call]);
    messages.push(reply);
    console.log(JSON.stringify(reply));
  }
  const results = messages.filter(message => message.role === 'tool').map(message => JSON.parse(JSON.parse(message.content).content[0].text));
  assert.equal(results[0].body.status, 'CLEAR');
  assert.equal(results[1].status, 201);
  assert.equal(results[1].body.id, 'MOCK-REFUND-toolkit-1');
  assert.equal(results[2].body.id, results[1].body.id);
  const [denied] = await adapter.dispatch([{ id: 'denied', type: 'function', function: { name: 'create_refund', arguments: JSON.stringify({ capture_id: 'MOCK-CAPTURE-toolkit' }) } }]);
  assert.equal(JSON.parse(denied.content).isError, true);
  await assert.rejects(adapter.dispatch([{ id: 'bad', type: 'function', function: { name: 'send_money', arguments: '{}' } }]), /Unsupported/);
  await assert.rejects(createStillToolkitAdapter({ toolkit: { getTools: () => [{ type: 'function', function: { name: 'send_money' } }] }, client }), /cannot bind/);
  console.log(JSON.stringify({ gatewayDenial: 'returned to agent', unsupportedTool: 'rejected', messageCount: messages.length }));
} finally {
  await client.close();
}
