import { replayFailureSpec } from './replay-dispute.mjs';
import { createHash } from 'node:crypto';
import { parseMoney } from './paypal-mock.mjs';
import { passingReplaySpec } from './replay-passing-spec.mjs';
import { normalizeToolkitReplay } from './replay-toolkit-trace.mjs';

const keyFor = (batchId, result) => JSON.stringify([batchId, String(result.personaId), result.trial]);
const digest = value => createHash('sha256').update(value).digest('hex');

/** Build a deterministic queue. maxRuns limits the ready slice, not the failure queue. */
export function planSandboxReplays({ batchId, batch, maxRuns, offset = 0, samplePasses = 0, seed = 'still-replay-v1' } = {}) {
  if (typeof batchId !== 'string' || !batchId || !Array.isArray(batch?.results) || batch.provenance !== 'deterministic-mock') throw new TypeError('Provide a batch ID and a deterministic-mock trial batch.');
  if (!Number.isSafeInteger(maxRuns) || maxRuns < 0 || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(samplePasses) || samplePasses < 0 || typeof seed !== 'string') throw new TypeError('maxRuns and samplePasses must be nonnegative integers and seed must be a string.');
  const seen = new Set();
  const failures = [], passes = [];
  for (const result of batch.results) {
    if (!result || result.personaId == null || !Number.isSafeInteger(result.trial) || result.trial < 1 || !['pass', 'fail', 'unverified'].includes(result.status) || !Array.isArray(result.events)) throw new TypeError('Each trial needs a persona ID, trial number, status and events.');
    const key = keyFor(batchId, result);
    if (seen.has(key)) throw new Error('Duplicate persona and trial identity in batch.');
    seen.add(key);
    const item = { key, personaId: String(result.personaId), trial: result.trial, status: result.status, events: result.events, finalPayment: result.finalPayment, toolkitProtocol: result.toolkitProtocol === true || batch.protocolVersion === 3 };
    if (result.status === 'fail') failures.push(item);
    if (result.status === 'pass') passes.push(item);
  }
  const order = (a, b) => a.key.localeCompare(b.key);
  failures.sort(order);
  passes.sort((a, b) => digest(JSON.stringify([seed, a.key])).localeCompare(digest(JSON.stringify([seed, b.key]))) || order(a, b));
  const queue = [...failures.map(item => ({ ...item, reason: 'failure' })), ...passes.slice(0, samplePasses).map(item => ({ ...item, reason: 'sampled-pass' }))];
  return { batchId, seed, maxRuns, offset, samplePassesRequested: samplePasses, failureCount: failures.length, sampledPassCount: Math.min(samplePasses, passes.length), excludedUnverifiedCount: batch.results.filter(item => item.status === 'unverified').length, queueCount: queue.length, readyCount: Math.min(maxRuns, Math.max(0, queue.length - offset)), deferredCount: queue.length - Math.min(maxRuns, Math.max(0, queue.length - offset)), queue: queue.map((item, index) => ({ ...item, queueState: index >= offset && index < offset + maxRuns ? 'ready' : 'deferred' })) };
}

function comparable(item) {
  const normalized = normalizeToolkitReplay(item);
  if (normalized.reason) return normalized;
  item = normalized.item;
  if (item.status === 'fail') return replayFailureSpec(item);
  const special = passingReplaySpec(item);
  if (special.kind) return special;
  const calls = item.events.filter(event => event.type === 'tool_call' && event.tool === 'create_refund');
  if (calls.length !== 1) return { reason: 'Only a single explicit refund on a fresh capture is comparable; retries and no-call traces need a separate executor.' };
  const disputes = item.events.filter(event => event.type === 'tool_result' && event.tool === 'get_dispute');
  if (disputes.length !== 1 || disputes[0].response?.status !== 'NONE') return { reason: 'Only a trace with a clear mock dispute state is comparable; dispute scenarios require real dispute evidence.' };
  const call = calls[0], args = call.arguments || {};
  const responses = item.events.filter(event => event.type === 'tool_result' && event.tool === 'create_refund' && event.callId === call.id);
  if (responses.length !== 1 || !responses[0].response || responses[0].response.status == null) return { reason: 'The mock response is missing or ambiguous.' };
  const payment = item.finalPayment;
  if (!payment || !['PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment.status) || !payment.amount || parseMoney(payment.amount.value) === null || !/^[A-Z]{3}$/.test(payment.amount.currency_code || '')) return { reason: 'The mock capture is not a refunded payment with a known amount and currency.' };
  if (typeof args.amount !== 'string' || parseMoney(args.amount) === null || parseMoney(args.amount) <= 0 || args.currency !== payment.amount.currency_code || args.captureId || args.customerId || args.orderId) return { reason: 'The refund must specify an amount and currency on the scenario capture; identity-changing and omitted-amount requests are unsupported.' };
  const response = responses[0].response;
  if (response.status !== 201 || response.body?.status !== 'COMPLETED' || parseMoney(response.body?.amount?.value) !== parseMoney(args.amount) || response.body?.amount?.currency_code !== args.currency) return { reason: 'Only confirmed mock refund successes are comparable.' };
  if (parseMoney(payment.refunded) !== parseMoney(args.amount) || payment.status !== (parseMoney(args.amount) === parseMoney(payment.amount.value) ? 'REFUNDED' : 'PARTIALLY_REFUNDED')) return { reason: 'The mock capture state does not match its single refund.' };
  return { amount: args.amount, currency: args.currency, captureAmount: payment.amount.value, mockResponse: response, ...(call.toolkitNoRequestId ? { sendWithoutRequestId: true } : {}) };
}

function unverified(item, reason) {
  return { key: item.key, personaId: item.personaId, trial: item.trial, status: 'unverified', reason };
}

/** Trusted server-only integration. Never bind checkout, adapter, ledger, or history lookup to request data. */
export async function executePlannedSandboxReplay({ plan, key, sessionId, checkout, adapter, ledger } = {}) {
  const blocked = reason => ({ status: 'unverified', reason });
  const item = Array.isArray(plan?.queue) ? plan.queue.find(entry => entry.key === key) : undefined;
  if (!item || item.queueState !== 'ready') return blocked('Choose a ready replay from the server-owned plan.');
  const expected = comparable(item);
  if (expected.reason) return blocked(expected.reason);
  if (typeof sessionId !== 'string' || !sessionId || !adapter || typeof ledger?.execute !== 'function') return blocked('A server-owned sandbox session and replay ledger are required.');
  if (checkout?.state !== 'captured' || checkout.buyerApprovalConfirmed !== true || !checkout.captureId || checkout.capture?.id !== checkout.captureId || checkout.capture?.status !== 'COMPLETED' || parseMoney(checkout.capture?.amount?.value) !== parseMoney(expected.captureAmount) || checkout.capture?.amount?.currency_code !== expected.currency) return blocked('A matching captured checkout with provider-confirmed buyer approval is required.');
  // A sandbox-only checkout belongs to this replay and is reserved once.
  // PayPal does not supply a complete real-time refund ledger; external activity remains possible.
  if (checkout.replayKey !== key) return blocked('The sandbox checkout belongs to another replay.');
  if (expected.disputeRequired && !checkout.replayDisputeId) return blocked('Attach a verified open sandbox dispute to this capture before replay.');
  checkout.state = 'replaying';
  // Treat the capture as spent even when a reservation or provider outcome is uncertain.
  checkout.state = 'spent';
  try {
    const receipt = await ledger.execute({ item, sessionId, adapter, approval: { sessionId, captureId: checkout.captureId, buyerApprovedFreshCapture: true, disputeId: checkout.replayDisputeId } });
    return { status: receipt.source === 'paypal-sandbox' ? 'executed' : 'unverified', receipt };
  } catch {
    return blocked('The replay outcome could not be recorded. Do not retry this capture automatically.');
  }
}

/** Compare trusted local executor receipts. This function never invokes an adapter or sends a payment. */
export function reconcileSandboxReplays({ plan, evidence = [], verifyReceipt } = {}) {
  if (!plan || !Array.isArray(plan.queue) || !Array.isArray(evidence)) throw new TypeError('Provide a replay plan and evidence array.');
  if (verifyReceipt !== undefined && typeof verifyReceipt !== 'function') throw new TypeError('verifyReceipt must be a trusted synchronous receipt verifier.');
  const byKey = new Map(), captureKeys = new Map();
  for (const receipt of evidence) {
    if (!receipt || typeof receipt.key !== 'string' || byKey.has(receipt.key)) throw new Error('Evidence must have a unique replay key.');
    byKey.set(receipt.key, receipt);
    const captureId = receipt.capture?.body?.id;
    if (captureId) captureKeys.set(captureId, (captureKeys.get(captureId) || 0) + 1);
  }
  const results = plan.queue.map(item => {
    const receipt = byKey.get(item.key);
    if (!receipt && item.queueState !== 'ready') return unverified(item, 'Deferred by the execution limit.');
    const expected = comparable(item);
    if (expected.reason) return unverified(item, expected.reason);
    if (!receipt) return unverified(item, 'No executor receipt was supplied.');
    const simulated = receipt.source === 'simulated-provider-fixture' && receipt.simulated === true;
    if (!simulated && (receipt.source !== 'paypal-sandbox' || receipt.executor !== 'trusted-local' || receipt.simulated !== false || receipt.buyerApprovedFreshCapture !== true && receipt.humanApprovedFreshCapture !== true && receipt.funding !== 'paypal-sandbox-test-card')) return unverified(item, 'A trusted local executor must attest to a real sandbox response and a buyer-approved fresh capture.');
    if (!simulated) {
      let verified = false;
      try { verified = verifyReceipt?.(receipt, item) === true; } catch { /* A failed verifier cannot establish provenance. */ }
      if (!verified) return unverified(item, 'A server-owned verifier has not authenticated this executor receipt.');
    }
    if (expected.kind === 'no-refund') {
      const capture = receipt.capture, captureId = capture?.body?.id;
      if (!capture?.ok || capture.status !== 200 || capture.body?.status !== 'COMPLETED' || !captureId || /^MOCK-/i.test(captureId) || captureKeys.get(captureId) !== 1 || parseMoney(capture.body.amount?.value) !== parseMoney(expected.captureAmount) || capture.body.amount?.currency_code !== expected.currency || receipt.refundHistory !== 'not-established' || !Array.isArray(receipt.attempts) || receipt.attempts.length !== 0) return unverified(item, 'A matching sandbox capture and recorded absence of replay refund calls are required.');
      if (expected.disputeRequired && (receipt.dispute?.verified !== true || receipt.dispute.source !== 'paypal-sandbox' || receipt.dispute.captureId !== captureId)) return unverified(item, 'A PayPal-confirmed linked open dispute is required.');
      return { key: item.key, personaId: item.personaId, trial: item.trial, status: simulated ? 'simulated-agreed' : 'agreed', source: simulated ? 'simulated-provider-fixture' : 'paypal-sandbox', comparison: 'Recorded no-refund decision and matching sandbox capture', limitation: 'The agent decision and store identity facts are from the recorded mock trace. This does not establish complete external refund history or real customer identity.', provider: { captureId, status: capture.body.status, dispute: receipt.dispute }, refundCalls: 0 };
    }
    if (item.status === 'fail' || expected.kind === 'stable-retry') {
      const capture = receipt.capture, captureId = capture?.body?.id;
      if (!capture?.ok || capture.status !== 200 || capture.body?.status !== 'COMPLETED' || !captureId || /^MOCK-/i.test(captureId) || captureKeys.get(captureId) !== 1 || parseMoney(capture.body.amount?.value) !== parseMoney(expected.captureAmount) || capture.body.amount?.currency_code !== expected.currency || receipt.refundHistory !== 'not-established') return unverified(item, 'The sandbox capture evidence does not match.');
      if (!Array.isArray(receipt.attempts) || receipt.attempts.length !== expected.steps.length) return unverified(item, 'Not all refund calls have a verified provider response.');
      const comparisons = [];
      for (let i = 0; i < expected.steps.length; i++) {
        const step = expected.steps[i], attempt = receipt.attempts[i], refund = attempt?.refund, request = attempt?.request;
        if (expected.disputeRequired && (attempt?.dispute?.verified !== true || attempt.dispute.source !== 'paypal-sandbox' || attempt.dispute.httpStatus !== 200 || attempt.dispute.captureId !== captureId || !['OPEN','UNDER_REVIEW','WAITING_FOR_SELLER_RESPONSE','WAITING_FOR_BUYER_RESPONSE'].includes(attempt.dispute.status))) return unverified(item, 'A PayPal-confirmed open dispute linked to this capture is required before every refund.');
        if (request?.captureId !== captureId || request?.amount !== step.amount || request?.currency !== step.currency || (step.sendWithoutRequestId ? request?.requestId !== null : !request?.requestId) || !refund || typeof refund.ok !== 'boolean' || !Number.isInteger(refund.status)) return unverified(item, 'A provider refund request or response is incomplete.');
        if (refund.status >= 500 || [401, 403, 429].includes(refund.status)) return unverified(item, 'PayPal returned an uncertain or unavailable refund response; the refund outcome is not established.');
        if (refund.ok && (![200, 201].includes(refund.status) || typeof refund.body?.id !== 'string' || !refund.body.id || !['PENDING', 'COMPLETED'].includes(refund.body.status) || !refund.body.amount || parseMoney(refund.body.amount.value) === null || !/^[A-Z]{3}$/.test(refund.body.amount.currency_code || ''))) return unverified(item, 'The PayPal success response does not contain a complete observable refund.');
        if (!refund.ok && (refund.status < 400 || refund.status >= 500 || typeof refund.body?.name !== 'string' || !refund.body.name || !Array.isArray(refund.body.details) || !refund.body.details.some(detail => typeof detail?.issue === 'string' && detail.issue))) return unverified(item, 'A comparable provider rejection needs a 4xx response and an identifiable issue.');
        const statusMatch = step.mock.timeoutInjected ? refund.ok === true && [200, 201].includes(refund.status) : refund.status === step.mock.status;
        const match = step.mock.issue
          ? statusMatch && refund.ok === false && refund.body?.details?.some(detail => detail.issue === step.mock.issue)
          : statusMatch && refund.ok === true && refund.body?.status === step.mock.outcome && parseMoney(refund.body?.amount?.value) === parseMoney(step.mock.amount.value) && refund.body?.amount?.currency_code === step.mock.amount.currency_code;
        comparisons.push({ mock: step.mock, provider: refund, ...(expected.disputeRequired ? { dispute: attempt.dispute } : {}), match });
      }
      if (expected.steps.length === 2 && !expected.steps.some(step => step.sendWithoutRequestId) && (expected.steps[0].decision === expected.steps[1].decision) !== (receipt.attempts[0].request.requestId === receipt.attempts[1].request.requestId)) return unverified(item, 'The provider request IDs do not preserve the recorded retry identity.');
      if (expected.steps.length === 2 && expected.steps.every(step => step.mock.id) && receipt.attempts.every(attempt => attempt.refund.body?.id)) {
        const mockSame = expected.steps[0].mock.id === expected.steps[1].mock.id;
        const providerSame = receipt.attempts[0].refund.body?.id === receipt.attempts[1].refund.body?.id;
        comparisons[1].match = comparisons[1].match && mockSame === providerSame;
      }
      const agreement = comparisons.every(x => x.match);
      return { key: item.key, personaId: item.personaId, trial: item.trial, status: simulated ? (agreement ? 'simulated-agreed' : 'simulated-disagreed') : (agreement ? 'agreed' : 'disagreed'), source: simulated ? 'simulated-provider-fixture' : 'paypal-sandbox', comparison: 'Refund outcome, amount, currency, retry identity and observable HTTP status', limitation: 'Sandbox-only. Any timeout is injected after the real provider response. Refund history and exclusive access are not established. Synthetic order and customer facts do not establish real identity.', identityNote: expected.identityNote, disputeKind: receipt.disputeKind || (expected.disputeRequired ? 'unclassified-sandbox-dispute' : undefined), comparisons };
    }
    const capture = receipt.capture, refund = receipt.refund, request = receipt.request;
    const captureId = capture?.body?.id;
    if (!capture?.ok || capture.status !== 200 || capture.body?.status !== 'COMPLETED' || typeof captureId !== 'string' || !captureId || /^MOCK-/i.test(captureId) || captureKeys.get(captureId) !== 1 || parseMoney(capture.body?.amount?.value) !== parseMoney(expected.captureAmount) || capture.body?.amount?.currency_code !== expected.currency || receipt.refundHistory !== 'not-established') return unverified(item, 'The capture evidence is missing, reused, not fresh, or differs from the mock capture.');
    if (request?.captureId !== captureId || parseMoney(request?.amount) !== parseMoney(expected.amount) || request?.currency !== expected.currency || (expected.sendWithoutRequestId ? request?.requestId !== null : typeof request?.requestId !== 'string' || !request.requestId)) return unverified(item, 'The executed refund request does not match the mock action and approved capture.');
    if (!refund || !Number.isInteger(refund.status) || typeof refund.ok !== 'boolean' || !refund.body || typeof refund.body !== 'object') return unverified(item, 'A complete PayPal refund response is required.');
    if (refund.ok && (refund.status !== 201 || !['COMPLETED', 'PENDING'].includes(refund.body.status) || typeof refund.body.id !== 'string' || !refund.body.id || /^MOCK-/i.test(refund.body.id) || parseMoney(refund.body.amount?.value) !== parseMoney(expected.amount) || refund.body.amount?.currency_code !== expected.currency)) return unverified(item, 'The provider success response does not confirm the requested refund.');
    if (!refund.ok && (refund.status < 400 || refund.status >= 500 || typeof refund.body.name !== 'string' || !refund.body.name || !Array.isArray(refund.body.details) || !refund.body.details.some(detail => typeof detail?.issue === 'string' && detail.issue))) return unverified(item, 'A comparable provider rejection needs a 4xx response and an identifiable issue.');
    const agreement = refund.ok && refund.status === expected.mockResponse.status && refund.body.status === expected.mockResponse.body.status;
    return { key: item.key, personaId: item.personaId, trial: item.trial, status: simulated ? (agreement ? 'simulated-agreed' : 'simulated-disagreed') : (agreement ? 'agreed' : 'disagreed'), source: simulated ? 'simulated-provider-fixture' : 'paypal-sandbox', comparison: 'HTTP status, refund outcome, amount and currency', limitation: 'Provider refund history and exclusive access are not established; this is a sandbox-only comparison.', mock: { status: expected.mockResponse.status, outcome: expected.mockResponse.body.status, amount: expected.mockResponse.body.amount }, provider: { captureId, status: refund.status, ok: refund.ok, refundId: refund.body.id, outcome: refund.body.status, amount: refund.body.amount, name: refund.body.name, issues: refund.body.details?.map(detail => detail.issue).filter(Boolean), debugId: refund.debugId } };
  });
  const agreed = results.filter(result => result.status === 'agreed').length;
  const disagreed = results.filter(result => result.status === 'disagreed').length;
  const compared = agreed + disagreed;
  return { source: 'replay-reconciliation', agreed, disagreed, compared, simulated: results.filter(result => result.status.startsWith('simulated-')).length, unverified: results.filter(result => result.status === 'unverified').length, agreement: compared ? agreed / compared : null, results };
}

/** Describe one page of a server-owned plan without returning full trial traces. */
export function sandboxReplayPage({ plan, evidence = [], verifyReceipt, offset = 0, limit = 25 } = {}) {
  if (!plan || !Array.isArray(plan.queue)) throw new TypeError('A replay plan is required.');
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Offset must be nonnegative and limit must be between 1 and 100.');
  const selected = plan.queue.slice(offset, offset + limit);
  const comparison = reconcileSandboxReplays({ plan: { ...plan, queue: selected }, evidence, verifyReceipt });
  const receipts = new Map(evidence.map(receipt => [receipt.key, receipt]));
  return {
    total: plan.queueCount,
    offset,
    limit,
    nextOffset: offset + selected.length < plan.queueCount ? offset + selected.length : null,
    items: selected.map((item, index) => {
      const spec = comparable(item);
      const result = comparison.results[index];
      const receipt = receipts.get(item.key);
      let authenticated = false;
      if (receipt?.source === 'paypal-sandbox' && typeof verifyReceipt === 'function') {
        try { authenticated = verifyReceipt(receipt, item) === true; } catch { authenticated = false; }
      }
      const compared = result.status === 'agreed' || result.status === 'disagreed';
      const execution = compared ? 'recorded' : authenticated ? 'recorded-unverified' : spec.reason ? 'unsupported' : spec.disputeRequired ? 'requires-sandbox-dispute' : 'supported';
      const reason = compared ? null : authenticated ? 'A sandbox replay was recorded, but its outcome is unverified. Do not automatically repeat it.' : spec.reason || (spec.disputeRequired ? 'A real open dispute must be linked to this replay capture.' : null);
      return { index: offset + index, personaId: item.personaId, trial: item.trial, selection: item.reason, execution, reason, comparison: result };
    }),
  };
}
