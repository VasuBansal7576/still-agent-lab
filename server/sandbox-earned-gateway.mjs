import { createHash } from 'node:crypto';
import { createPayPalSandbox } from './paypal.mjs';
import { derivePermission } from './gateway.mjs';
import { planSandboxReplays, reconcileSandboxReplays } from './sandbox-replay.mjs';
import { parseMoney } from './paypal-mock.mjs';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value);
const money = value => { if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(value)) return null; const amount = parseMoney(value); return amount > 0 ? amount : null; };
const decimal = value => `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;

// A targeted PayPal observation can identify a known dispute, but an empty
// listing is not proof that provider records are complete or up to date.
export async function observeSandboxDisputes({ credentials, paypal, captureId } = {}) {
  if (!validId(captureId)) return { allowed: false, reason: 'Invalid capture for sandbox dispute lookup.' };
  try {
    const authorization = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
    const tokenResponse = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials',
    });
    const token = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || typeof token.access_token !== 'string') return { allowed: false, reason: 'PayPal sandbox dispute authentication unavailable.' };
    const query = new URLSearchParams({ disputed_transaction_id: captureId, page_size: '50' });
    const response = await fetch(`https://api-m.sandbox.paypal.com/v1/customer/disputes?${query}`, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.items) || !Array.isArray(data.links) || data.links.some(link => link?.rel === 'next')) return { allowed: false, reason: 'PayPal sandbox dispute listing is unavailable or incomplete.' };
    for (const item of data.items) {
      if (!validId(item?.dispute_id)) return { allowed: false, reason: 'PayPal sandbox returned an unidentifiable dispute.' };
      const detail = await paypal.getAccountDispute(item.dispute_id);
      if (!detail.ok || detail.status !== 200 || detail.body?.id !== item.dispute_id || !Array.isArray(detail.body.sellerTransactionIds) || !detail.body.sellerTransactionIds.includes(captureId) || detail.body.status !== 'RESOLVED') return { allowed: false, reason: 'PayPal reports an unresolved or unverifiable dispute for the capture.' };
    }
    return { allowed: true, observation: 'No unresolved dispute returned by the sandbox lookup; absence remains unverified.' };
  } catch {
    return { allowed: false, reason: 'PayPal sandbox dispute lookup failed.' };
  }
}

// This grant is usable only by a host that can establish the store facts required below.
export async function earnSandboxPermission({ batchId, batch, ledger, currency = 'USD' } = {}) {
  if (!validId(batchId) || !ledger || typeof ledger.evidence !== 'function' || typeof ledger.verifyReceipt !== 'function' || !Array.isArray(batch?.results) || batch.results.some(result => result.status !== 'pass')) throw new Error('A fully passing saved batch and trusted replay ledger are required.');
  const results = batch.results.filter(result => result.finalPayment?.amount?.currency_code === currency);
  const summary = { ...batch, results, personaCount: new Set(results.map(result => result.personaId)).size };
  const mock = derivePermission({ agentId: batch.evaluatedAgentId, currency, summary });
  if (!mock.create_refund.allowed) throw new Error('The batch does not earn a mock permission for this currency.');
  const plan = planSandboxReplays({ batchId, batch, maxRuns: 10, samplePasses: 10 });
  const allPlan = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses: batch.results.length });
  const scopedPlan = { ...allPlan, queue: allPlan.queue.filter(item => item.finalPayment?.amount?.currency_code === currency) };
  const comparison = reconcileSandboxReplays({ plan: scopedPlan, evidence: await ledger.evidence(), verifyReceipt: ledger.verifyReceipt });
  if (comparison.disagreed) throw new Error('A sandbox replay disagreed with the mock.');
  const sampled = new Set(plan.queue.filter(item => item.finalPayment?.amount?.currency_code === currency).map(item => item.key));
  const matches = comparison.results.filter(result => sampled.has(result.key) && result.status === 'agreed' && result.source === 'paypal-sandbox' && result.provider?.amount?.currency_code === currency && money(result.provider.amount.value) !== null);
  if (!matches.length) throw new Error('A verified sampled sandbox replay in this currency is required.');
  const observed = Math.max(...matches.map(result => money(result.provider.amount.value)));
  const ceiling = Math.min(money(mock.create_refund.maxPerOrder), observed);
  return { version: 1, agentId: batch.evaluatedAgentId, scope: 'paypal-sandbox-only', batchId, evidence: { mockTrials: summary.results.length, sandboxCompared: matches.length, coverage: 'Sampled sandbox agreement in this currency does not establish all failures, complete PayPal history, or real-world safety.' }, create_refund: { ...mock.create_refund, maxPerOrder: decimal(ceiling) } };
}

// `store` and `reserve` are host-owned trusted inputs, never user-supplied JSON.
// PayPal's sandbox API cannot itself prove a complete refund/dispute history.
export function createSandboxEarnedGateway({ permission, credentials, store, reserve, scenarioMode = false } = {}) {
  if (permission?.scope !== 'paypal-sandbox-only' || !validId(permission.agentId) || !validId(permission.batchId) || permission.create_refund?.allowed !== true || money(permission.create_refund.maxPerOrder) === null || !/^[A-Z]{3}$/.test(permission.create_refund.currency || '') || typeof store?.inspect !== 'function' || typeof reserve !== 'function') throw new Error('A sandbox permission, trusted store and durable reservation are required.');
  const paypal = createPayPalSandbox(credentials);
  let chain = Promise.resolve();
  return { async refund({ agentId, captureId, orderId, customerId, amount, currency, decisionId } = {}) {
    const execute = async () => {
      const denied = reason => ({ ok: false, blocked: true, reason, source: 'still-gateway' });
      if (agentId !== permission.agentId || !validId(captureId) || !validId(orderId) || !validId(customerId) || !validId(decisionId) || currency !== permission.create_refund.currency || money(amount) === null || money(amount) > money(permission.create_refund.maxPerOrder)) return denied('Request exceeds or does not match the earned permission.');
      let facts, capture;
      try { [facts, capture] = await Promise.all([store.inspect({ captureId, orderId, customerId }), paypal.getCapture(captureId)]); } catch { return denied('Store or sandbox payment context unavailable.'); }
      const acceptableFacts = scenarioMode ? facts?.provenance === 'sandbox-scenario' && facts.complete === false && facts.disputeState === 'SYNTHETIC_CLEAR' : facts?.provenance === 'trusted-store' && facts.complete === true && facts.disputeState === 'CLEAR';
      if (!acceptableFacts || facts.captureId !== captureId || facts.orderId !== orderId || facts.customerId !== customerId || facts.currency !== currency || facts.disputeChecked !== true || facts.cancellationComplete !== false || money(facts.approvedRemaining) === null || money(facts.paymentRemaining) === null || money(amount) > money(facts.approvedRemaining) || money(amount) > money(facts.paymentRemaining)) return denied('Trusted identity, approved amount, complete payment history and a clear dispute check are required.');
      const dispute = await observeSandboxDisputes({ credentials, paypal, captureId });
      if (!dispute.allowed) return denied(dispute.reason);
      if (!capture.ok || capture.status !== 200 || capture.body?.id !== captureId || capture.body?.status !== 'COMPLETED' || capture.body?.amount?.currency_code !== currency || money(capture.body?.amount?.value) === null || money(amount) > money(capture.body.amount.value)) return denied('PayPal did not confirm a matching completed sandbox capture.');
      const requestId = `still-${createHash('sha256').update(JSON.stringify([permission.batchId,agentId,captureId,decisionId])).digest('hex').slice(0,40)}`;
      try { if (await reserve({ batchId: permission.batchId, captureId, decisionId, requestId }) !== true) return denied('Capture or decision was already reserved.'); } catch { return denied('A durable reservation could not be established.'); }
      try { const result = await paypal.refundCapture(captureId, { amount, currency, requestId }); return { source: 'paypal-sandbox', requestId, result, disputeObservation: dispute.observation, ...(scenarioMode ? { scenarioFacts: 'synthetic', externalRefundHistory: 'not-established', realDisputeState: 'not-established' } : {}) }; }
      catch { return { ok: false, uncertain: true, source: 'paypal-sandbox', reason: 'Refund outcome unknown. Do not retry automatically.', requestId }; }
    };
    const result = chain.then(execute); chain = result.catch(() => {}); return result;
  } };
}
