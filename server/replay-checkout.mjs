import { replayFailureSpec } from './replay-dispute.mjs';
import { randomUUID } from 'node:crypto';
import { parseMoney } from './paypal-mock.mjs';
import { passingReplaySpec } from './replay-passing-spec.mjs';

const decimal = value => typeof value === 'string' && /^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(value) && parseMoney(value) > 0;
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value);

function approvalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.sandbox.paypal.com' && !url.username && !url.password && !url.port;
  } catch { return false; }
}

// The item must come from a plan built from a server-owned batch, never from the request body.
export function replayCheckoutAmount(item) {
  if (!item || item.queueState !== 'ready' || typeof item.key !== 'string' || !item.key || !Array.isArray(item.events)) return null;
  if (item.status === 'fail') { const spec = replayFailureSpec(item); return spec.reason ? null : { amount: spec.captureAmount, currency: spec.currency }; }
  const special = passingReplaySpec(item);
  if (special.kind) return { amount: special.captureAmount, currency: special.currency };
  const calls = item.events.filter(event => event.type === 'tool_call' && event.tool === 'create_refund');
  const disputes = item.events.filter(event => event.type === 'tool_result' && event.tool === 'get_dispute');
  if (calls.length !== 1 || disputes.length !== 1 || disputes[0].response?.status !== 'NONE') return null;
  const args = calls[0].arguments || {};
  const responses = item.events.filter(event => event.type === 'tool_result' && event.tool === 'create_refund' && event.callId === calls[0].id);
  const payment = item.finalPayment;
  const amount = payment?.amount?.value, currency = payment?.amount?.currency_code;
  if (!['PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment?.status) || !decimal(amount) || !/^[A-Z]{3}$/.test(currency || '') || !decimal(args.amount) || args.currency !== currency || parseMoney(args.amount) > parseMoney(amount) || args.captureId || args.customerId || args.orderId || parseMoney(payment.refunded) !== parseMoney(args.amount) || payment.status !== (parseMoney(args.amount) === parseMoney(amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED')) return null;
  const response = responses[0]?.response;
  if (responses.length !== 1 || response?.status !== 201 || response.body?.status !== 'COMPLETED' || parseMoney(response.body.amount?.value) !== parseMoney(args.amount) || response.body.amount?.currency_code !== currency) return null;
  return { amount, currency };
}

/** Create an order for a trusted planned item with the current session's sandbox adapter. */
export async function createReplayCheckout({ session, item } = {}) {
  const expected = replayCheckoutAmount(item);
  if (!expected) return { status: 'invalid', error: 'The selected replay cannot use a matching checkout.' };
  if (!session?.paypal || typeof session.paypal.createOrder !== 'function') return { status: 'unavailable', error: 'Connect a PayPal sandbox account first.' };
  if (session.checkout && session.checkout.state !== 'spent') return { status: 'conflict', error: 'An existing checkout must be resolved first.', checkout: session.checkout };

  const checkout = { state: 'creating', ...expected, replayKey: item.key, requestId: randomUUID() };
  session.checkout = checkout;
  try {
    const result = await session.paypal.createOrder({ ...expected, requestId: randomUUID() });
    if (identifier(result.body?.id)) checkout.orderId = result.body.id;
    if (result.ok && checkout.orderId && approvalUrl(result.body?.approvalUrl)) {
      checkout.approvalUrl = result.body.approvalUrl;
      checkout.state = 'approval_required';
      return { status: 'approval_required', checkout };
    }
  } catch { /* The provider may have received the request. */ }
  checkout.state = 'create_unknown';
  checkout.error = 'Order creation could not be confirmed. Do not create another order in this session.';
  return { status: 'create_unknown', error: checkout.error, checkout };
}
