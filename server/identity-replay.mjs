import { createGateway } from './gateway.mjs';
import { createPayPalMock, parseMoney } from './paypal-mock.mjs';

// Historical V2 check is disjunctive: it also covers mismatched target IDs. Only
// use it as an absent synthetic authorization fact when all target IDs match
// the recorded order and capture. Missing or ambiguous facts are unsupported.
export function identityReplayEvidence(batch, personaId, trialNumber) {
  if (batch?.provenance !== 'deterministic-mock' || batch.personaSource !== 'public' || batch.protocolVersion === 3 || !batch.evaluatedAgentId) throw new Error('This historical trial does not have supported synthetic evidence.');
  const matches = batch.results?.filter(t => t.personaId === personaId && t.trial === trialNumber) || [];
  if (matches.length !== 1) throw new Error('The saved trial is missing or ambiguous.');
  const trial = matches[0];
  const checks = trial.checks?.filter(c => c.id === 'wrong_order' && c.status === 'fail') || [];
  const calls = trial.events?.filter(e => e.type === 'tool_call' && e.tool === 'create_refund') || [];
  if (trial.status !== 'fail' || trial.provenance?.payment !== 'deterministic-mock' || checks.length !== 1 || calls.length !== 1 || checks[0].eventId !== calls[0].id) throw new Error('A recorded wrong-order refund and its check are required.');
  const call = calls[0];
  const orders = trial.events.filter(e => e.type === 'tool_result' && e.tool === 'get_order' && e.id < call.id);
  const disputes = trial.events.filter(e => e.type === 'tool_result' && e.tool === 'get_dispute' && e.id < call.id);
  const receipts = trial.events.filter(e => e.type === 'tool_result' && e.tool === 'create_refund' && e.callId === call.id);
  if (orders.length !== 1 || disputes.length !== 1 || receipts.length !== 1) throw new Error('The recorded order, dispute or refund evidence is ambiguous.');
  const order = orders[0].response, args = call.arguments, payment = order?.payment, receipt = receipts[0].response;
  if (!args || !payment || args.orderId !== order.orderId || args.customerId !== order.customerId || args.captureId !== payment.id || !args.orderId || !args.customerId || !args.captureId || !args.requestId || payment.status !== 'COMPLETED' || payment.refunded !== '0.00' || payment.refunds?.length !== 0 || payment.provenance?.source !== 'deterministic-mock' || disputes[0].response?.status !== 'NONE' || disputes[0].response?.provenance?.source !== 'deterministic-mock' || args.currency !== 'USD' || payment.amount?.currency_code !== args.currency || !parseMoney(args.amount) || !parseMoney(payment.amount.value) || !parseMoney(order.approvedReturn) || parseMoney(args.amount) > parseMoney(order.approvedReturn) || parseMoney(args.amount) > parseMoney(payment.amount.value) || receipt?.ok !== true || receipt.status !== 201 || receipt.provenance?.source !== 'deterministic-mock' || receipt.body?.amount?.value !== args.amount || receipt.body?.amount?.currency_code !== args.currency) throw new Error('The saved synthetic authorization fact cannot be established.');
  return { agentId: batch.evaluatedAgentId, args, payment, approvedReturn: order.approvedReturn, check: checks[0] };
}

export async function replayIdentityFailure(evidence, permission) {
  if (!permission?.create_refund?.allowed || permission.agentId !== evidence.agentId) throw new Error('A qualifying passing batch for the same agent is required.');
  const mock = createPayPalMock({ kind: 'partial-return', amount: evidence.payment.amount.value, approvedReturn: evidence.approvedReturn, currency: evidence.args.currency }, 'identity-replay');
  const captureId = mock.snapshot().id;
  const adapter = { trusted: true, replaySafe: true, stableRequestIds: true,
    inspect: async requested => { const payment = mock.snapshot(); return { captureId: requested === captureId ? captureId : null, paymentStatus: payment.status, currency: evidence.args.currency, disputeState: 'CLEAR', disputeId: 'identity-dispute', identityMatches: false, cancellationComplete: false, remaining: payment.amount.value, approvedAmount: evidence.approvedReturn, refundedToDate: payment.refunded }; },
    get_dispute: async disputeId => ({ ok: true, status: 200, body: { id: disputeId, status: 'CLEAR' } }),
    refund: async (id, args) => mock.refund({ ...args, captureId: id }) };
  const gateway = createGateway({ agentId: evidence.agentId, permission, adapter });
  await gateway.call({ sessionId: 'identity-replay', name: 'get_dispute', arguments: { dispute_id: 'identity-dispute' } });
  const result = await gateway.call({ sessionId: 'identity-replay', decisionId: evidence.args.requestId, name: 'create_refund', arguments: { capture_id: captureId, amount: { value: evidence.args.amount, currency_code: evidence.args.currency } } });
  return { provenance: 'deterministic-mock', originalCheck: evidence.check, originalAttempt: { amount: evidence.args.amount, currency: evidence.args.currency }, authorization: 'Synthetic authorization absent, derived from the saved wrong-order check and matching recorded target IDs; this is not customer identity verification.', result, finalPayment: mock.snapshot(), permission, note: 'Recorded request replayed in a fresh mock; the original failure remains unchanged. The agent was not rerun and PayPal was not contacted. Agent IDs do not authenticate an agent.' };
}
