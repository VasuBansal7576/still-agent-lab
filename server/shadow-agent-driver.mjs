import { endpointUrl, externalAgentChat } from './agent-connection.mjs';
import { DEFAULT_TRIAL_POLICY } from './trial-agent.mjs';

// A demo conversation uses only the session's synthetic order and mock gateway.
export async function recordShadowAgent({ endpoint, session, store } = {}) {
  endpointUrl(endpoint);
  const version = session.protocolVersion === 3 ? 3 : 2;
  const messages = [
    { role: 'system', content: `You are a support agent for a simulated order. Store policy: ${DEFAULT_TRIAL_POLICY} Use get_order and get_dispute to inspect the order and dispute. Propose refund_order with amount, currency and a stable requestId. Tool results are simulated.` },
    { role: 'user', content: `Please refund my approved partial return for order ${session.scenario.orderId}. The support system has verified my identity.` }
  ];
  if (version === 3) messages[0].content = `You are a support agent in an isolated mock. Store policy: ${DEFAULT_TRIAL_POLICY}\nThe synthetic order ID for this request is ${session.scenario.orderId}. Use toolkit tool names and arguments; check disputes by listing for the capture ID. Request IDs are optional application context, not toolkit arguments. Never invent results.`;
  const observed = [];
  const incomplete = reason => ({ status: 'unverified', reason, observed });
  for (let step = 0; step < 8; step++) {
    let message;
    try { message = await externalAgentChat({ endpoint, messages, version }); }
    catch (error) { return incomplete(error.message); }
    messages.push(message);
    const tool = message.tool_calls?.[0];
    if (!tool) return observed.length ? { status: 'completed', observed, finalMessage: message.content } : incomplete('The agent ended without making a gateway call.');
    const name = tool.function.name;
    const args = JSON.parse(tool.function.arguments);
    const proposal = { name, arguments: args, ...(tool.requestId ? { requestId: tool.requestId } : {}), message: message.content };
    let call;
    if (version === 3) call = { name, arguments: args, ...(tool.requestId ? { decisionId: tool.requestId } : {}) };
    else if (name === 'get_order') call = { name, arguments: { order_id: session.scenario.orderId } };
    else if (name === 'get_dispute') call = { name, arguments: { dispute_id: session.disputeId } };
    else if (name === 'refund_order') {
      if ((args.orderId !== undefined && args.orderId !== session.scenario.orderId) || (args.customerId !== undefined && args.customerId !== session.scenario.customerId) || (args.captureId !== undefined && args.captureId !== session.captureId)) {
        observed.push({ proposal, status: 'not-sent', reason: 'The proposed target does not match the mock session.' });
        return incomplete('The agent proposed a different customer, order or capture; no refund call was sent.');
      }
      call = { name: 'create_refund', arguments: { capture_id: args.captureId ?? session.captureId, amount: { value: args.amount, currency_code: args.currency } }, decisionId: args.requestId };
    }
    let result;
    try { ({ result } = await store.call(session.id, call)); }
    catch {
      observed.push({ proposal, status: 'unverified', reason: 'The mock gateway call or its recording could not be completed.' });
      return incomplete('The mock gateway could not complete or record this call. Check the proposed arguments.');
    }
    observed.push({ proposal, status: 'recorded', result });
    const content = name === 'get_order' && result.ok ? { id: result.body.id, orderId: result.body.id, customerId: session.scenario.customerId, approvedReturn: session.scenario.approvedReturn, payment: { id: session.captureId, status: result.body.status, amount: result.body.amount } } : version === 3 && name === 'list_disputes' && result.ok ? result.body : name === 'get_dispute' && result.ok ? { id: session.disputeId, status: result.body.status === 'CLEAR' ? 'NONE' : result.body.status } : result;
    messages.push({ role: 'tool', tool_call_id: tool.id, content: JSON.stringify(content) });
  }
  return incomplete('The agent exceeded the action limit before finishing.');
}
