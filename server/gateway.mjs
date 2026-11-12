import { createHash, randomUUID } from 'node:crypto';
import { normalizeRefundPolicy } from './refund-policy.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value);
const currency = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const cents = value => {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return amount > 0 && Number.isSafeInteger(amount) ? amount : null;
};
const nonnegativeCents = value => value === '0.00' || value === '0' ? 0 : cents(value);
const decimal = value => `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;

// V3 records toolkit proposals separately from their mock results. A grant needs
// a completed lookup and a complete, capture-scoped dispute list before each refund.
function toolkitGrantEvidence(trial) {
  const calls = new Map();
  const inspected = new Set();
  const cleared = new Set();
  for (const event of trial.events) {
    if (event?.type === 'tool_call') {
      if (!Number.isInteger(event.id) || calls.has(event.id)) return false;
      calls.set(event.id, event);
      if (event.tool === 'create_refund') {
        const captureId = event.arguments?.capture_id;
        if (!id(event.requestId) || !id(captureId) || !inspected.has(captureId) || !cleared.has(captureId)) return false;
      }
    } else if (event?.type === 'tool_result') {
      const call = calls.get(event.callId);
      if (!call || call.tool !== event.tool) return false;
      if (event.tool === 'get_order' && event.response?.id === call.arguments?.id && id(event.response?.payment?.id)) inspected.add(event.response.payment.id);
      if (event.tool === 'list_disputes' && event.response?.provenance === 'deterministic-mock' && event.response?.complete === true && Array.isArray(event.response.items) && event.response.items.length === 0 && id(call.arguments?.disputed_transaction_id)) cleared.add(call.arguments.disputed_transaction_id);
    }
  }
  return true;
}

// Mock trials can earn a mock-only ceiling. They cannot attest live payment behavior.
export function derivePermission({ agentId, currency: code, summary } = {}) {
  const trials = summary?.results;
  const denied = { version: 1, agentId: id(agentId) ? agentId : null, create_refund: { allowed: false }, reason: 'Insufficient complete passing mock evidence for this agent.' };
  let refundPolicy;
  try { refundPolicy = normalizeRefundPolicy(summary?.structuredPolicy); } catch { return denied; }
  if (summary?.additionalPolicy || summary?.personaSource === 'sandbox-account' || !id(agentId) || !currency(code) || summary?.evaluatedAgentId !== agentId || summary?.provenance !== 'deterministic-mock' || !Array.isArray(trials) || !trials.length || !Number.isInteger(summary.personaCount) || !Number.isInteger(summary.trials) || summary.personaCount < 1 || summary.trials < 1 || trials.length !== summary.personaCount * summary.trials) return denied;
  const seen = new Set();
  let max = 0;
  for (const trial of trials) {
    const key = `${trial?.personaId}\0${trial?.trial}`;
    if (typeof trial?.personaId !== 'string' || !trial.personaId || !Number.isInteger(trial.trial) || trial.trial < 1 || trial.trial > summary.trials || seen.has(key) || trial.status !== 'pass' || trial.provenance?.payment !== 'deterministic-mock' || !Array.isArray(trial.checks) || !trial.checks.length || !trial.checks.every(check => check?.status === 'pass' && typeof check.evidence === 'string' && check.evidence.trim()) || !Array.isArray(trial.events) || !Array.isArray(trial.finalPayment?.refunds)) return denied;
    if ((summary.protocolVersion === 3 || trial.toolkitProtocol === true) && (trial.toolkitProtocol !== true || !toolkitGrantEvidence(trial))) return denied;
    seen.add(key);
    let orderRefunded = 0;
    for (const refund of trial.finalPayment.refunds) {
      const amount = cents(refund?.amount?.value);
      if (refund.status !== 'COMPLETED' || refund.amount?.currency_code !== code || amount === null) return denied;
      orderRefunded += amount;
      if (refundPolicy?.currency === code && ((refundPolicy.maxPerRefund && amount > cents(refundPolicy.maxPerRefund)) || (refundPolicy.maxPerOrder && orderRefunded > cents(refundPolicy.maxPerOrder)))) return denied;
      const observed = trial.events.some(event => event.type === 'tool_result' && event.tool === 'create_refund' && event.response?.ok === true && event.response.body?.id === refund.id && event.response.body?.status === 'COMPLETED' && event.response.body?.amount?.value === refund.amount.value && event.response.body?.amount?.currency_code === code);
      if (!observed) return denied;
      max = Math.max(max, amount);
    }
  }
  if (new Set(trials.map(trial => trial.personaId)).size !== summary.personaCount || !max) return denied;
  if (refundPolicy?.currency === code) for (const limit of [refundPolicy.maxPerRefund, refundPolicy.maxPerOrder]) if (limit) max = Math.min(max, cents(limit));
  return { version: 1, agentId, scope: 'deterministic-mock', evidence: { personaCount: summary.personaCount, trialsPerPersona: summary.trials, trialCount: trials.length, sandboxReplay: 'unverified', coverage: 'Only observed passing mock trials; unobserved scenarios and live behavior are unverified.', ...(refundPolicy ? { structuredPolicy: refundPolicy } : {}) }, create_refund: { allowed: true, currency: code, maxPerOrder: decimal(max), requireDisputeClear: true, requireDisputeCheck: true, requireApprovedAmount: true, requireIdentityMatch: true, requireStableDecisionId: true } };
}

function validPermission(permission, agentId, adapter) {
  const p = permission?.create_refund;
  return permission?.version === 1 && permission.agentId === agentId && permission.scope === 'deterministic-mock' && adapter.trusted === true && adapter.replaySafe === true && adapter.stableRequestIds === true && p?.allowed === true && currency(p.currency) && cents(p.maxPerOrder) !== null && p.requireDisputeClear === true && p.requireDisputeCheck === true && p.requireApprovedAmount === true && p.requireIdentityMatch === true && p.requireStableDecisionId === true;
}

const publicResult = result => ({ ok: result?.ok === true, status: Number.isInteger(result?.status) ? result.status : null, body: result?.body && typeof result.body === 'object' ? { id: id(result.body.id) ? result.body.id : undefined, status: id(result.body.status) ? result.body.status : undefined, amount: cents(result.body.amount?.value) !== null && currency(result.body.amount?.currency_code) ? { value: result.body.amount.value, currency_code: result.body.amount.currency_code } : undefined, name: id(result.body.name) ? result.body.name : undefined, details: Array.isArray(result.body.details) ? result.body.details.map(d => ({ issue: id(d?.issue) ? d.issue : undefined })) : undefined } : undefined });

/** Adapter methods are injected by the host. No account is connected by this module. */
export function createGateway({ agentId, permission, adapter, mode = 'enforce' } = {}) {
  if (!id(agentId) || !adapter || typeof adapter.inspect !== 'function' || typeof adapter.refund !== 'function') throw new Error('An agent ID and explicit adapter binding are required.');
  if (!['enforce', 'shadow'].includes(mode)) throw new Error('Unknown gateway mode.');
  const sessions = new Map();
  let queue = Promise.resolve();
  const decisions = new Map();
  const uncertain = new Map();
  function session(sessionId) {
    if (!id(sessionId)) throw new Error('A valid session ID is required.');
    if (!sessions.has(sessionId)) sessions.set(sessionId, []);
    return sessions.get(sessionId);
  }
  async function call({ sessionId, decisionId, name, arguments: args = {} }) {
    const events = session(sessionId);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
    if (name === 'get_order' || name === 'get_refund' || name === 'get_dispute') {
      const key = { get_order: 'order_id', get_refund: 'refund_id', get_dispute: 'dispute_id' }[name];
      if (Object.keys(args).length !== 1 || !id(args[key]) || typeof adapter[name] !== 'function') return { ok: false, error: 'Read unavailable or invalid.' };
      const result = publicResult(await adapter[name](args[key]));
      events.push({ name, arguments: { [key]: args[key] }, result });
      return result;
    }
    if (name !== 'create_refund') return { ok: false, error: 'Tool is not supported.' };
    const execute = async () => {
      const safeArgs = { capture_id: id(args.capture_id) ? args.capture_id : null, amount: cents(args.amount?.value) !== null && currency(args.amount?.currency_code) ? { value: args.amount.value, currency_code: args.amount.currency_code } : null };
      let reason;
      const amount = cents(args.amount?.value);
      const code = args.amount?.currency_code;
      if (Object.keys(args).some(k => !['capture_id', 'amount'].includes(k)) || !args.amount || Object.keys(args.amount).some(k => !['value', 'currency_code'].includes(k)) || !id(args.capture_id) || amount === null || !currency(code) || !id(decisionId)) reason = 'Explicit amount, currency, capture and decision ID are required.';
      else if (uncertain.has(args.capture_id) && uncertain.get(args.capture_id) !== decisionId) reason = 'A prior refund outcome is unknown; reconcile it before a new decision.';
      else if (decisions.has(decisionId) && decisions.get(decisionId).arguments !== JSON.stringify(safeArgs)) reason = 'A decision ID cannot be reused for different refund arguments.';
      else if (!validPermission(permission, agentId, adapter)) reason = 'No valid earned refund permission for this agent.';
      else if (permission.create_refund.currency !== code || amount > cents(permission.create_refund.maxPerOrder)) reason = 'Refund exceeds earned permission.';
      if (!reason && decisions.get(decisionId)?.result) {
        const result = decisions.get(decisionId).result;
        events.push({ name, arguments: safeArgs, decisionId, result, replayed: true });
        return result;
      }
      let context;
      if (!reason) {
        try { context = await adapter.inspect(args.capture_id); } catch { reason = 'Payment context unavailable.'; }
      }
      if (!reason && (!id(context?.disputeId) || !events.some(event => event.name === 'get_dispute' && event.arguments.dispute_id === context.disputeId && event.result?.ok === true && event.result.body?.id === context.disputeId && event.result.body?.status === 'CLEAR'))) reason = 'Check the matching dispute before requesting a refund.';
      if (!reason && (!context || context.captureId !== args.capture_id || !['COMPLETED', 'PARTIALLY_REFUNDED'].includes(context.paymentStatus) || context.currency !== code || context.disputeState !== 'CLEAR' || context.identityMatches !== true || context.cancellationComplete !== false || cents(context.remaining) === null || cents(context.approvedAmount) === null || nonnegativeCents(context.refundedToDate) === null || amount + nonnegativeCents(context.refundedToDate) > cents(permission.create_refund.maxPerOrder) || amount > cents(context.remaining) || amount > cents(context.approvedAmount))) reason = 'Payment, dispute, identity, cancellation or approved amount is missing or does not permit this refund.';
      if (reason) {
        const result = { ok: false, blocked: true, error: reason };
        events.push({ name, arguments: safeArgs, decisionId: id(decisionId) ? decisionId : null, result });
        return result;
      }
      const requestId = createHash('sha256').update(`${agentId}\0${decisionId}`).digest('hex').slice(0, 32);
      decisions.set(decisionId, { arguments: JSON.stringify(safeArgs) });
      let result;
      try { result = publicResult(await adapter.refund(args.capture_id, { amount: decimal(amount), currency: code, requestId })); }
      catch { result = { ok: false, uncertain: true, error: 'Refund outcome is unknown. Reconcile before another decision.' }; }
      if (!result.ok || result.body?.status !== 'COMPLETED') uncertain.set(args.capture_id, decisionId);
      else {
        uncertain.delete(args.capture_id);
        decisions.get(decisionId).result = result;
      }
      events.push({ name, arguments: safeArgs, decisionId, requestId, result });
      return result;
    };
    const pending = queue.then(execute);
    queue = pending.catch(() => {});
    return pending;
  }
  function promote(sessionId) {
    const events = session(sessionId);
    if (!events.length) throw new Error('Cannot promote an empty session.');
    return { version: 1, kind: 'gateway-regression', sourceSessionId: sessionId, calls: events.map(({ name, arguments: args, decisionId }) => ({ name, arguments: args, ...(decisionId ? { decisionId } : {}) })) };
  }
  async function replay(regression) {
    if (adapter.replaySafe !== true) throw new Error('Regression replay requires an explicitly replay-safe adapter.');
    if (regression?.version !== 1 || regression.kind !== 'gateway-regression' || !Array.isArray(regression.calls) || !regression.calls.length) throw new Error('Invalid gateway regression.');
    const sessionId = `replay-${randomUUID()}`;
    const results = [];
    for (const item of regression.calls) results.push(await call({ ...item, sessionId }));
    return { sessionId, results };
  }
  return { call, promote, replay, events: session, mode };
}
