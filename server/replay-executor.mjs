import { executeFailureReplay } from './replay-failure-executor.mjs';
import { createHash } from 'node:crypto';
import { parseMoney } from './paypal-mock.mjs';
import { passingReplaySpec } from './replay-passing-spec.mjs';
import { verifyReplayDispute } from './replay-dispute.mjs';
import { normalizeToolkitReplay } from './replay-toolkit-trace.mjs';

const idPattern = /^[A-Za-z0-9_-]{1,127}$/;
const amount = value => value && typeof value === 'object' ? { value: typeof value.value === 'string' && parseMoney(value.value) !== null ? value.value : undefined, currency_code: /^[A-Z]{3}$/.test(value.currency_code || '') ? value.currency_code : undefined } : undefined;
const safeString = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,127}$/.test(value) ? value : undefined;
const safeResponse = response => ({
  ok: response?.ok, status: response?.status,
  body: {
    id: safeString(response?.body?.id), status: safeString(response?.body?.status),
    amount: amount(response?.body?.amount), name: safeString(response?.body?.name),
    details: Array.isArray(response?.body?.details) ? response.body.details.map(detail => ({ issue: safeString(detail?.issue) })).filter(detail => detail.issue) : undefined,
  },
  debugId: safeString(response?.debugId),
});
const failed = (key, reason, extra = {}) => ({ key, source: 'unverified-executor', reason, ...extra });

/** Execute one comparable replay. All arguments are supplied by a trusted server-side caller. */
export async function executeSandboxReplay({ item, sessionId, approval, adapter, reserve, simulated = false } = {}) {
  const normalized = normalizeToolkitReplay(item);
  if (normalized.reason) return failed(item?.key, normalized.reason);
  item = normalized.item;
  if (item?.status === 'fail') return executeFailureReplay({ item, sessionId, approval, adapter, reserve, simulated });
  const passSpec = passingReplaySpec(item);
  if (passSpec.kind === 'stable-retry') return executeFailureReplay({ item: { ...item, status: 'fail' }, sessionId, approval, adapter, reserve, simulated });
  if (passSpec.kind === 'no-refund') {
    const key = item.key, captureId = approval?.captureId;
    if (!sessionId || approval?.sessionId !== sessionId || (approval?.buyerApprovedFreshCapture !== true && approval?.funding !== 'paypal-sandbox-test-card') || !idPattern.test(captureId || '') || /^MOCK-/i.test(captureId) || typeof adapter?.getCapture !== 'function' || typeof reserve !== 'function') return failed(key, 'A fresh sandbox capture and durable reservation are required.');
    let capture;
    try { capture = safeResponse(await adapter.getCapture(captureId)); } catch { return failed(key, 'Capture lookup failed.'); }
    if (!capture.ok || capture.status !== 200 || capture.body.id !== captureId || capture.body.status !== 'COMPLETED' || parseMoney(capture.body.amount?.value) !== parseMoney(passSpec.captureAmount) || capture.body.amount?.currency_code !== passSpec.currency) return failed(key, 'The sandbox capture does not match the mock capture.', { capture });
    let dispute;
    if (passSpec.disputeRequired) {
      dispute = await verifyReplayDispute({ adapter, disputeId: approval.disputeId, checkout: { state: 'captured', captureId, buyerApprovalConfirmed: true, replayKey: key } });
      if (!dispute.verified) return failed(key, 'A linked unresolved sandbox dispute is required.', { capture, dispute });
    }
    try { if (await reserve({ sessionId, captureId, key }) !== true) return failed(key, 'Capture or replay was already reserved.', { capture }); } catch { return failed(key, 'Reservation failed.', { capture }); }
    return { key, capture, dispute, attempts: [], status: 'no-refund', source: simulated ? 'simulated-provider-fixture' : 'paypal-sandbox', simulated, executor: 'trusted-local', buyerApprovedFreshCapture: approval?.buyerApprovedFreshCapture === true, ...(approval?.funding === 'paypal-sandbox-test-card' ? { funding: 'paypal-sandbox-test-card' } : {}), refundHistory: 'not-established' };
  }
  const key = item?.key;
  if (typeof key !== 'string' || !key || item?.queueState !== 'ready' || !Array.isArray(item?.events)) return failed(key, 'A ready replay item is required.');
  const calls = (item.events || []).filter(event => event.type === 'tool_call' && event.tool === 'create_refund');
  const disputes = (item.events || []).filter(event => event.type === 'tool_result' && event.tool === 'get_dispute');
  const call = calls[0], args = call?.arguments || {}, payment = item.finalPayment;
  const responses = (item.events || []).filter(event => event.type === 'tool_result' && event.tool === 'create_refund' && event.callId === call?.id);
  if (calls.length !== 1 || disputes.length !== 1 || disputes[0].response?.status !== 'NONE' || responses.length !== 1 || responses[0].response?.status !== 201 || responses[0].response?.body?.status !== 'COMPLETED' || !['PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment?.status) || parseMoney(payment.amount?.value) === null || !/^[A-Z]{3}$/.test(payment.amount?.currency_code || '') || typeof args.amount !== 'string' || !/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(args.amount) || parseMoney(args.amount) === null || parseMoney(args.amount) <= 0 || args.currency !== payment.amount.currency_code || args.captureId || args.customerId || args.orderId || parseMoney(responses[0].response.body.amount?.value) !== parseMoney(args.amount) || responses[0].response.body.amount?.currency_code !== args.currency || parseMoney(payment.refunded) !== parseMoney(args.amount) || payment.status !== (parseMoney(args.amount) === parseMoney(payment.amount.value) ? 'REFUNDED' : 'PARTIALLY_REFUNDED')) return failed(key, 'The mock trace is not a comparable single explicit refund.');
  const captureId = approval?.captureId;
  if (typeof sessionId !== 'string' || !sessionId || approval?.sessionId !== sessionId || (approval?.buyerApprovedFreshCapture !== true && approval?.funding !== 'paypal-sandbox-test-card') || !idPattern.test(captureId || '') || /^MOCK-/i.test(captureId)) return failed(key, 'A fresh capture explicitly approved for this sandbox session is required.');
  if (typeof adapter?.getCapture !== 'function' || typeof adapter?.refundCapture !== 'function' || typeof reserve !== 'function') return failed(key, 'A sandbox adapter and durable atomic reservation are required.');
  let capture;
  try { capture = safeResponse(await adapter.getCapture(captureId)); } catch (error) { return failed(key, 'Capture lookup failed.', { error: { stage: 'capture', name: safeString(error?.name) || 'Error' } }); }
  if (!capture.ok || capture.status !== 200 || capture.body.id !== captureId || capture.body.status !== 'COMPLETED' || parseMoney(capture.body.amount?.value) !== parseMoney(payment.amount.value) || capture.body.amount?.currency_code !== args.currency || parseMoney(args.amount) > parseMoney(capture.body.amount?.value)) return failed(key, 'The provider capture does not match the completed mock capture.', { capture });
  const requestId = call.toolkitNoRequestId ? undefined : `still-${createHash('sha256').update(JSON.stringify([sessionId, captureId, key])).digest('hex').slice(0, 40)}`;
  const request = { captureId, amount: args.amount, currency: args.currency, requestId: requestId ?? null };
  try {
    if (await reserve({ sessionId, captureId, key, requestId }) !== true) return failed(key, 'Capture or replay was already reserved.', { capture, request });
  } catch (error) { return failed(key, 'Reservation failed; no refund was attempted.', { capture, request, error: { stage: 'reservation', name: safeString(error?.name) || 'Error' } }); }
  let refund;
  try { refund = safeResponse(await adapter.refundCapture(captureId, { amount: args.amount, currency: args.currency, requestId })); }
  catch (error) { return failed(key, 'Refund outcome is uncertain. Do not retry automatically.', { capture, request, error: { stage: 'refund', name: safeString(error?.name) || 'Error' } }); }
  const base = { key, capture, request, refund, refundHistory: 'not-established' };
  const success = refund.ok && refund.status === 201 && ['COMPLETED', 'PENDING'].includes(refund.body.status) && refund.body.id && !/^MOCK-/i.test(refund.body.id) && parseMoney(refund.body.amount?.value) === parseMoney(args.amount) && refund.body.amount?.currency_code === args.currency;
  const rejection = !refund.ok && refund.status >= 400 && refund.status < 500 && refund.body.name && refund.body.details?.some(detail => detail.issue);
  if (!success && !rejection) return failed(key, 'Provider response is not a confirmed comparable success or rejection.', base);
  return { ...base, status: success ? refund.body.status.toLowerCase() : 'rejected', source: simulated ? 'simulated-provider-fixture' : 'paypal-sandbox', simulated, executor: 'trusted-local', buyerApprovedFreshCapture: approval?.buyerApprovedFreshCapture === true, ...(approval?.funding === 'paypal-sandbox-test-card' ? { funding: 'paypal-sandbox-test-card' } : {}) };
}
