import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createMcpTrialAgent } from '../server/mcp-trial-agent.mjs';
import { generatePersonas } from '../server/personas.mjs';
import { runTrials } from '../server/trials.mjs';

const install = process.env.STILL_TOOLKIT_INSTALL;
if (!install) throw new Error('Set STILL_TOOLKIT_INSTALL to a directory containing the toolkit and MCP SDK.');
const require = createRequire(resolve(install, 'package.json'));
const { PayPalAgentToolkit } = require('@paypal/agent-toolkit/openai');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const sdk = { Server, Client, InMemoryTransport, ListToolsRequestSchema, CallToolRequestSchema };
const toolkit = new PayPalAgentToolkit({ clientId: 'unused', clientSecret: 'unused', configuration: { actions: { orders: { get: true }, disputes: { list: true }, payments: { createRefund: true } }, context: { sandbox: true } } });
const mode = process.env.STILL_AGENT_MODE || 'safe';
if (!['safe', 'unsafe'].includes(mode)) throw new Error('STILL_AGENT_MODE must be safe or unsafe.');
const agent = createMcpTrialAgent({ sdk, toolkit, async runAgent({ client, customerRequest, orderId }) {
  const call = async (name, args, requestId) => {
    const result = await client.callTool({ name, arguments: args, ...(requestId ? { _meta: { stillRequestId: requestId } } : {}) });
    if (result.isError || result.content?.[0]?.type !== 'text') throw new Error('Mock tool failed.');
    return JSON.parse(result.content[0].text);
  };
  const order = await call('get_order', { id: orderId });
  const disputes = await call('list_disputes', { disputed_transaction_id: order.payment.id });
  if (mode === 'safe' && (disputes.items.length || /other customer|without checking my identity|on behalf of the account owner/i.test(customerRequest))) return 'This request needs manual handling.';
  const amount = mode === 'safe' ? order.approvedReturn : order.payment.amount.value;
  const args = { capture_id: order.payment.id, amount: { value: amount, currency_code: order.payment.amount.currency_code } };
  const result = await call('create_refund', args, mode === 'safe' ? 'approved-refund' : undefined);
  if (result.error === 'TIMEOUT_OUTCOME_UNKNOWN') await call('create_refund', args, mode === 'safe' ? 'approved-refund' : undefined);
  return 'The mock request has finished.';
} });
const count = Number(process.env.STILL_PERSONAS || 10), trials = Number(process.env.STILL_TRIALS || 5);
const result = await runTrials({ personas: generatePersonas({ count }), trials, concurrency: 5, agent, agentId: 'mcp-scripted-example' });
console.log(JSON.stringify({ mode, provenance: result.provenance, counts: result.counts, passAt1: result.passAt1, passAllTrials: result.passAllTrials, example: result.results[0], failureClusters: result.failureClusters.map(({ id, count }) => ({ id, count })) }, null, 2));
if (result.counts.fail || result.counts.unverified) process.exitCode = 1;
