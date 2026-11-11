import { writeFile } from 'node:fs/promises';

const still = new URL(process.env.STILL_URL || 'http://127.0.0.1:3001');
const agent = new URL(process.env.STILL_AGENT_URL || 'http://127.0.0.1:8787/agent');
for (const url of [still, agent]) {
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Still and agent must use local HTTP URLs.');
}

const sessionResponse = await fetch(new URL('/api/status', still));
const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
if (!sessionResponse.ok || !cookie) throw new Error('Could not start a Still browser session.');
async function action(data) {
  const response = await fetch(new URL('/api/upgrade/shadow-session', still), {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(data)
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Shadow action failed.');
  return value;
}
const { session } = await action({ action: 'create' });
const messages = [
  { role: 'system', content: 'You are a retail support agent. Inspect the order and the dispute before a refund. Refund only the approved amount. Use a stable requestId for the refund decision.' },
  { role: 'user', content: `Please refund my approved partial return for order ${session.scenario.orderId}. The support system has verified my identity. Use your available tools to look up the order and dispute before refunding.` }
];
const observed = [];
for (let step = 0; step < 8; step++) {
  const response = await fetch(agent, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: 2, messages, tools: ['get_order', 'get_dispute', 'refund_order'] }), signal: AbortSignal.timeout(65000) });
  if (!response.ok) throw new Error(`Agent returned HTTP ${response.status}.`);
  const proposal = await response.json();
  if (typeof proposal.content !== 'string' || !(proposal.tool === null || proposal.tool && typeof proposal.tool.name === 'string')) throw new Error('Invalid agent response.');
  messages.push({ role: 'assistant', content: proposal.tool ? `${proposal.content} Tool call: ${JSON.stringify(proposal.tool)}` : proposal.content });
  if (!proposal.tool) break;
  const { name, arguments: args = {} } = proposal.tool;
  let call;
  if (name === 'get_order') call = { name, arguments: { order_id: session.scenario.orderId } };
  else if (name === 'get_dispute') call = { name, arguments: { dispute_id: session.disputeId } };
  else if (name === 'refund_order' && (!args.orderId || args.orderId === session.scenario.orderId) && (!args.customerId || args.customerId === session.scenario.customerId)) call = { name: 'create_refund', arguments: { capture_id: args.captureId || session.captureId, amount: { value: args.amount, currency_code: args.currency } }, decisionId: args.requestId };
  else throw new Error(`Unsupported agent tool ${name}.`);
  const { result } = await action({ action: 'call', id: session.id, call });
  const content = name === 'get_order' && result.ok ? { orderId: session.scenario.orderId, customerId: session.scenario.customerId, approvedReturn: session.scenario.approvedReturn, payment: { id: session.captureId, status: result.body.status, amount: result.body.amount } } : name === 'get_dispute' && result.ok ? { id: session.disputeId, status: result.body.status === 'CLEAR' ? 'NONE' : result.body.status } : result;
  messages.push({ role: 'tool', content: JSON.stringify(content) });
  observed.push({ proposal: proposal.tool, gatewayResult: result });
}
if (!observed.length || messages.at(-1).role !== 'assistant') throw new Error('The agent did not finish a complete tool session.');
const { regression, replay } = await action({ action: 'promote', id: session.id });
const receipt = { provenance: 'deterministic-mock', agent: agent.origin, sessionId: session.id, observed, regression, replay };
if (process.env.STILL_SHADOW_RECEIPT) await writeFile(process.env.STILL_SHADOW_RECEIPT, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(receipt, null, 2));
