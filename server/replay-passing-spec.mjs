import { parseMoney } from './paypal-mock.mjs';
import { replayFailureSpec } from './replay-dispute.mjs';

export function passingReplaySpec(item) {
  if (item?.status !== 'pass' || !Array.isArray(item.events)) return { reason: 'Not a passing trial.' };
  const calls = item.events.filter(event => event.type === 'tool_call' && event.tool === 'create_refund');
  if (calls.length === 2) {
    const spec = replayFailureSpec({ ...item, status: 'fail' });
    if (spec.reason) return spec;
    if (spec.steps.length !== 2 || !spec.steps[0].mock.timeoutInjected || spec.steps[0].decision !== spec.steps[1].decision || spec.steps[0].mock.id !== spec.steps[1].mock.id) return { reason: 'Only a stable-id retry after a mock timeout is supported.' };
    return { ...spec, kind: 'stable-retry' };
  }
  if (calls.length) return { reason: 'Not a no-refund or retry trace.' };
  const orders = item.events.filter(event => event.type === 'tool_result' && event.tool === 'get_order');
  const disputes = item.events.filter(event => event.type === 'tool_result' && event.tool === 'get_dispute');
  const payment = orders[0]?.response?.payment, final = item.finalPayment;
  const amount = payment?.amount?.value, currency = payment?.amount?.currency_code;
  if (orders.length !== 1 || disputes.length !== 1 || !['NONE', 'OPEN'].includes(disputes[0].response?.status) || payment?.status !== 'COMPLETED' || final?.status !== 'COMPLETED' || parseMoney(payment.refunded) !== 0 || parseMoney(final.refunded) !== 0 || parseMoney(amount) <= 0 || final.amount?.value !== amount || final.amount?.currency_code !== currency || !/^[A-Z]{3}$/.test(currency || '')) return { reason: 'No-refund replay requires an unchanged fresh capture and an observed mock dispute state.' };
  return { kind: 'no-refund', captureAmount: amount, currency, disputeRequired: disputes[0].response.status === 'OPEN' };
}
