import { failureReplaySpec } from './replay-failure-spec.mjs';

const idPattern = /^[A-Za-z0-9_-]{1,127}$/;
const unresolved = new Set(['OPEN', 'UNDER_REVIEW', 'WAITING_FOR_SELLER_RESPONSE', 'WAITING_FOR_BUYER_RESPONSE']);

// Refund parsing is shared with ordinary failures. This copy is only for parsing;
// callers must verify the actual sandbox dispute before accepting a replay.
export function disputeFailureReplaySpec(item) {
  if (item?.status !== 'fail' || !Array.isArray(item.events)) return { reason: 'Not a failed trial.' };
  const disputes = item.events.filter(event => event.type === 'tool_result' && event.tool === 'get_dispute');
  if (disputes.length !== 1 || disputes[0].response?.status !== 'OPEN') return { reason: 'The mock trace does not show one open dispute.' };
  const normalized = { ...item, events: item.events.map(event => event === disputes[0] ? { ...event, response: { ...event.response, status: 'NONE' } } : event) };
  const result = failureReplaySpec(normalized);
  return result.reason ? result : { ...result, disputeRequired: true };
}

// IDs must be bound to a server-owned checkout, not a browser-supplied capture.
export async function verifyReplayDispute({ adapter, disputeId, checkout } = {}) {
  if (!idPattern.test(disputeId || '') || !idPattern.test(checkout?.captureId || '') || checkout?.state !== 'captured' || checkout?.buyerApprovalConfirmed !== true || typeof checkout?.replayKey !== 'string') return { verified: false, reason: 'A dispute ID and a matching, buyer-approved replay checkout are required.' };
  if (typeof adapter?.getAccountDispute !== 'function') return { verified: false, reason: 'Sandbox dispute lookup is unavailable.' };
  let response;
  try { response = await adapter.getAccountDispute(disputeId); }
  catch { return { verified: false, reason: 'Sandbox dispute lookup failed.' }; }
  const body = response?.body;
  if (response?.ok !== true || response.status !== 200 || body?.id !== disputeId || !unresolved.has(body.status) || !Array.isArray(body.sellerTransactionIds) || body.sellerTransactionIds.length !== 1 || body.sellerTransactionIds[0] !== checkout.captureId) {
    return { verified: false, reason: 'PayPal did not confirm an unresolved dispute linked exclusively to this replay capture.', httpStatus: Number.isInteger(response?.status) ? response.status : null, disputeStatus: typeof body?.status === 'string' ? body.status : null };
  }
  return { verified: true, source: 'paypal-sandbox', httpStatus: 200, id: body.id, status: body.status, captureId: checkout.captureId, amount: body.amount || null, observedAt: new Date().toISOString() };
}

export function replayFailureSpec(item) {
  const open = item?.events?.some(event => event.type === 'tool_result' && event.tool === 'get_dispute' && event.response?.status === 'OPEN');
  return open ? disputeFailureReplaySpec(item) : failureReplaySpec(item);
}
