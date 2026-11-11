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
  for (const call of calls) {
    const args = call.arguments || {};
    const responses = item.events.filter(e => e.type === 'tool_result' && e.tool === 'create_refund' && e.callId === call.id);
    if (responses.length !== 1 || ![200, 201].includes(responses[0].response?.status) || responses[0].response?.body?.status !== 'COMPLETED') return { reason: 'A confirmed mock refund response is required for each call.' };
    if (args.currency !== currency || (args.amount !== undefined && (typeof args.amount !== 'string' || parseMoney(args.amount) === null || parseMoney(args.amount) <= 0))) return { reason: 'The refund amount or currency is not comparable.' };
    if (args.captureId) return { reason: 'A different mock capture cannot be mapped to this sandbox capture.' };
    const responseAmount = responses[0].response.body.amount;
    if (parseMoney(responseAmount?.value) === null || responseAmount?.currency_code !== currency) return { reason: 'The mock refund amount is missing.' };
    steps.push({ amount: args.amount, currency, decision: typeof args.requestId === 'string' ? args.requestId : `call-${call.id}`, mock: { status: responses[0].response.status, outcome: responses[0].response.body.status, amount: responseAmount, id: responses[0].response.body.id }, syntheticIdentity: Boolean(args.orderId || args.customerId) });
  }
  return { captureAmount, currency, steps, identityNote: steps.some(s => s.syntheticIdentity) ? 'Order or customer mismatch is a synthetic scenario fact. PayPal receives the supplied sandbox capture ID.' : undefined };
}
