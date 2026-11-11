import { createHash } from 'node:crypto';
import { parseMoney } from './paypal-mock.mjs';
import { replayFailureSpec, verifyReplayDispute } from './replay-dispute.mjs';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value) && !/^MOCK-/i.test(value);
const safeResponse = response => ({ ok: response?.ok, status: response?.status, body: { id: validId(response?.body?.id) ? response.body.id : undefined, status: typeof response?.body?.status === 'string' ? response.body.status : undefined, amount: response?.body?.amount && { value: response.body.amount.value, currency_code: response.body.amount.currency_code }, name: typeof response?.body?.name === 'string' ? response.body.name : undefined, details: Array.isArray(response?.body?.details) ? response.body.details.map(x => ({ issue: x.issue })) : undefined } });

export async function executeFailureReplay({ item, sessionId, approval, adapter, reserve, simulated = false }) {
  const key = item.key, spec = replayFailureSpec(item);
  const failed = (reason, extra = {}) => ({ key, source: 'unverified-executor', reason, ...extra });
  if (spec.reason) return failed(spec.reason);
  const captureId = approval?.captureId;
  if (!sessionId || approval?.sessionId !== sessionId || approval?.buyerApprovedFreshCapture !== true || !validId(captureId)) return failed('A fresh buyer-approved sandbox capture is required.');
  if (spec.disputeRequired && (!validId(approval?.disputeId) || simulated)) return failed('A verified real sandbox dispute is required.');
  if (typeof adapter?.getCapture !== 'function' || typeof adapter?.refundCapture !== 'function' || typeof adapter?.refundCaptureWithoutAmount !== 'function' || typeof reserve !== 'function') return failed('A sandbox adapter and durable atomic reservation are required.');
  let capture;
  try { capture = safeResponse(await adapter.getCapture(captureId)); } catch { return failed('Capture lookup failed.'); }
  if (!capture.ok || capture.status !== 200 || capture.body.id !== captureId || capture.body.status !== 'COMPLETED' || parseMoney(capture.body.amount?.value) !== parseMoney(spec.captureAmount) || capture.body.amount?.currency_code !== spec.currency) return failed('The sandbox capture does not match the mock capture.', { capture });
  const requestIdFor = decision => `still-${createHash('sha256').update(JSON.stringify([sessionId, captureId, key, decision])).digest('hex').slice(0, 40)}`;
  try { if (await reserve({ sessionId, captureId, key, requestId: requestIdFor(spec.steps[0].decision) }) !== true) return failed('Capture or replay was already reserved.', { capture }); }
  catch { return failed('Reservation failed. No refund was attempted.', { capture }); }
  const attempts = [];
  for (const step of spec.steps) {
    const requestId = requestIdFor(step.decision);
    const request = { captureId, amount: step.amount, currency: step.currency, requestId };
    let dispute;
    if (spec.disputeRequired) {
      dispute = await verifyReplayDispute({ adapter, disputeId: approval.disputeId, checkout: { state: 'captured', captureId, buyerApprovalConfirmed: true, replayKey: key } });
      if (!dispute.verified) return failed('The sandbox dispute could not be verified immediately before the refund. No further refund was attempted.', { capture, attempts, dispute });
    }
    try {
      const raw = step.amount === undefined ? await adapter.refundCaptureWithoutAmount(captureId, { requestId }) : await adapter.refundCapture(captureId, { amount: step.amount, currency: step.currency, requestId });
      const refund = safeResponse(raw);
      attempts.push({ request, refund, ...(dispute ? { dispute } : {}) });
      if (!refund.ok || ![200, 201].includes(refund.status) || refund.body.status !== 'COMPLETED' || !validId(refund.body.id)) break;
    } catch { return failed('Refund outcome is uncertain. Do not retry automatically.', { capture, attempts }); }
  }
  return { key, capture, attempts, refundHistory: 'not-established', identityNote: spec.identityNote, status: 'completed', source: simulated ? 'simulated-provider-fixture' : 'paypal-sandbox', simulated, executor: 'trusted-local', buyerApprovedFreshCapture: true };
}
