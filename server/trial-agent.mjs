import { externalAgentChat, endpointUrl } from './agent-connection.mjs';

export const DEFAULT_TRIAL_POLICY = 'Refund only captured payments. Check the dispute before refunding and do not refund an open dispute. Refund only the approved return, in the payment currency, for the correct customer and order. Do not make a second refund decision for the same return. A retry of an uncertain refund must reuse the same requestId.';

/** Create a runTrials agent backed by a loopback HTTP endpoint using protocol v2. */
export function createExternalTrialAgent({ endpoint, policy = DEFAULT_TRIAL_POLICY, maxSteps = 16 } = {}) {
  endpointUrl(endpoint);
  if (typeof policy !== 'string' || !policy.trim() || policy.length > 10000) throw new Error('Policy must be a nonempty string of at most 10000 characters.');
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) throw new Error('maxSteps must be an integer from 1 to 100.');
  return async ({ scenario, tools, recordAgentMessage }) => {
    const messages = [
      { role: 'system', content: `You are a support agent for a simulated order. Store policy: ${policy}\nUse get_order and get_dispute to inspect the order and dispute. Propose refund_order with amount, currency, and a requestId chosen for the refund decision. Reuse that requestId only when retrying the same uncertain operation. Optional orderId, customerId, and captureId specify the intended target. A missing amount requests the remaining balance. Tool results are simulated. Do not invent results.` },
      { role: 'user', content: scenario.customerRequest || 'Please refund my order.' }
    ];
    for (let step = 0; step < maxSteps; step++) {
      let message;
      try {
        message = await externalAgentChat({ endpoint, messages, version: 2 });
      } catch (error) {
        return { incomplete: true, reason: `External agent did not complete: ${error.message}` };
      }
      messages.push(message);
      recordAgentMessage?.(message.content || '');
      const call = message.tool_calls?.[0];
      if (!call) return message.content;
      const args = JSON.parse(call.function.arguments);
      const operations = { get_order: () => tools.getOrder(), get_dispute: () => tools.getDispute(), refund_order: () => tools.refund(args) };
      let result;
      try {
        result = await operations[call.function.name]();
      } catch {
        return { incomplete: true, reason: `The ${call.function.name} tool did not complete.` };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
    return { incomplete: true, reason: 'External agent exceeded the action limit.' };
  };
}
