import { parseMoney } from './paypal-mock.mjs';

export function failureReplaySpec(item) {
  if (item?.status !== 'fail' || !Array.isArray(item.events)) return { reason: 'Not a failed trial.' };
  const order = item.events.find(e => e.type === 'tool_result' && e.tool === 'get_order')?.response;
  const payment = order?.payment;
  const captureAmount = payment?.amount?.value;
  const currency = payment?.amount?.currency_code;
  const disputes = item.events.filter(e => e.type === 'tool_result' && e.tool === 'get_dispute');
  if (disputes.length !== 1 || disputes[0].response?.status !== 'NONE') return { reason: 'An open-dispute replay requires a real dispute linked to the replay capture.' };
  if (payment?.status !== 'COMPLETED' || parseMoney(payment.refunded) !== 0 || parseMoney(captureAmount) <= 0 || !/^[A-Z]{3}$/.test(currency || '')) return { reason: 'A fresh mock capture is required.' };
  const calls = item.events.filter(e => e.type === 'tool_call' && e.tool === 'create_refund');
  if (calls.length < 1 || calls.length > 2) return { reason: 'Only one or two refund calls are currently supported.' };
  const steps = [];
  for (let index = 0; index < calls.length; index++) {
    const call = calls[index];
    const args = call.arguments || {};
    const responses = item.events.filter(e => e.type === 'tool_result' && e.tool === 'create_refund' && e.callId === call.id);
    if (responses.length !== 1) return { reason: 'A mock response is required for each call.' };
    const response = responses[0].response;
    const timedOut = index === 0 && calls.length === 2 && response?.error === 'TIMEOUT_OUTCOME_UNKNOWN';
    const ledgerRefund = timedOut && Array.isArray(item.finalPayment?.refunds) ? item.finalPayment.refunds[0] : null;
    if (timedOut && (!['COMPLETED', 'PENDING'].includes(ledgerRefund?.status) || typeof ledgerRefund.id !== 'string')) return { reason: 'A timed-out mock call needs a confirmed refund in its final ledger.' };
    const rejection = !timedOut && response?.ok === false && response.status === 422 && ['CAPTURE_FULLY_REFUNDED', 'REFUND_AMOUNT_EXCEEDED', 'REFUND_NOT_ALLOWED', 'REFUND_NOT_PERMITTED_DUE_TO_CHARGEBACK'].includes(response.body?.details?.[0]?.issue);
    if (!timedOut && !rejection && (![200, 201].includes(response?.status) || !['COMPLETED', 'PENDING'].includes(response?.body?.status))) return { reason: 'A confirmed mock refund response is required for each call.' };
    if (args.currency !== currency || (args.amount !== undefined && (typeof args.amount !== 'string' || parseMoney(args.amount) === null || parseMoney(args.amount) <= 0))) return { reason: 'The refund amount or currency is not comparable.' };
    if (args.captureId) return { reason: 'A different mock capture cannot be mapped to this sandbox capture.' };
    const responseAmount = timedOut ? ledgerRefund.amount : rejection ? { value: args.amount ?? captureAmount, currency_code: currency } : response.body.amount;
    if (parseMoney(responseAmount?.value) === null || responseAmount?.currency_code !== currency) return { reason: 'The mock refund amount is missing.' };
    if (timedOut && args.amount !== undefined && parseMoney(responseAmount.value) !== parseMoney(args.amount)) return { reason: 'The timed-out mock refund does not match its final ledger.' };
    steps.push({ amount: args.amount, currency, decision: typeof args.requestId === 'string' ? args.requestId : `call-${call.id}`, ...(call.toolkitNoRequestId ? { sendWithoutRequestId: true } : {}), mock: { status: timedOut ? null : response.status, outcome: timedOut ? ledgerRefund.status : response.body.status, issue: rejection ? response.body.details[0].issue : undefined, amount: responseAmount, id: timedOut ? ledgerRefund.id : response.body.id, timeoutInjected: timedOut }, syntheticIdentity: Boolean(args.orderId || args.customerId) });
  }
  return { captureAmount, currency, steps, identityNote: steps.some(s => s.syntheticIdentity) ? 'Order or customer mismatch is a synthetic scenario fact. PayPal receives the supplied sandbox capture ID.' : undefined };
}
