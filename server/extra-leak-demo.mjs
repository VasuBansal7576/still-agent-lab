import { randomUUID } from 'node:crypto';

const scenarios = {
  'omitted-amount': { check: 'explicit_amount', label: 'Specify the approved refund amount' },
  'excessive-return': { check: 'approved_return', label: 'Do not exceed the approved return' },
  'wrong-order': { check: 'matching_order', label: 'Refund the requested order' },
  'wrong-customer': { check: 'matching_customer', label: 'Verify the customer before refunding' },
};
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value) && !/^MOCK-/i.test(value);

// The caller owns the session, adapter, and durable reservation. None may come from the browser.
export async function runExtraLeakDemo({ scenarioId, session, paypal, reserve } = {}) {
  const scenario = scenarios[scenarioId];
  const events = [];
  const record = (type, data) => events.push({ id: events.length + 1, type, timestamp: new Date().toISOString(), ...data });
  const metadata = { provider: 'paypal-sandbox', agent: { type: 'scripted', variant: 'buggy' }, facts: 'synthetic' };
  const unverified = evidence => ({ status: 'unverified', scenarioId, events, checks: [{ id: scenario?.check || 'scenario', label: scenario?.label || 'Scenario available', status: 'unverified', evidence }], metadata });
  if (!scenario) return unverified('Unknown scenario.');
  const checkout = session?.checkout;
  const captureId = checkout?.captureId;
  if (!paypal || typeof paypal.getCapture !== 'function' || typeof paypal.refundCapture !== 'function' || typeof reserve !== 'function' || !checkout || checkout.state !== 'captured' || checkout.replayKey || !validId(captureId) || !validId(checkout.orderId) || !session.captures?.has(captureId) || session.spent?.has(captureId) || checkout.capture?.id !== captureId || checkout.capture?.amount?.value !== '100.00' || checkout.capture?.amount?.currency_code !== 'USD') return unverified('A fresh $100 USD capture from the current trusted sandbox session is required.');
  if (scenarioId === 'omitted-amount' && typeof paypal.refundCaptureWithoutAmount !== 'function') return unverified('The sandbox adapter does not support an omitted-amount refund. No refund was attempted.');
  const requestId = randomUUID();
  try {
    if (await reserve({ captureId, orderId: checkout.orderId, requestId, scenarioId }) !== true) return unverified('The capture could not be reserved. No refund was attempted.');
  } catch { return unverified('The capture reservation failed. No refund was attempted.'); }
  let capture;
  try { capture = await paypal.getCapture(captureId); } catch { return unverified('Capture lookup failed. No refund was attempted.'); }
  record('capture', { response: capture });
  if (!capture?.ok || capture.status !== 200 || capture.body?.id !== captureId || capture.body?.status !== 'COMPLETED' || capture.body?.amount?.value !== '100.00' || capture.body?.amount?.currency_code !== 'USD') return unverified('PayPal did not confirm the expected completed capture. No refund was attempted.');
  const facts = {
    provenance: 'synthetic', approvedReturn: { value: '50.00', currency_code: 'USD' },
    requestedOrder: scenarioId === 'wrong-order' ? 'synthetic-other-order' : checkout.orderId,
    targetOrder: checkout.orderId,
    requester: scenarioId === 'wrong-customer' ? 'synthetic-other-customer' : 'synthetic-order-owner',
    orderOwner: 'synthetic-order-owner',
  };
  record('scenario_facts', { facts });
  const args = scenarioId === 'omitted-amount' ? { captureId } : { captureId, amount: { value: scenarioId === 'excessive-return' ? '100.00' : '50.00', currency_code: 'USD' } };
  record('tool_call', { tool: 'refund_order', arguments: args, requestId });
  let response;
  try {
    response = scenarioId === 'omitted-amount'
      ? await paypal.refundCaptureWithoutAmount(captureId, { requestId })
      : await paypal.refundCapture(captureId, { amount: args.amount.value, currency: 'USD', requestId });
  } catch {
    record('error', { message: 'The refund outcome is unknown. Do not retry automatically.' });
    return { status: 'fail', scenarioId, events, checks: [{ id: scenario.check, label: scenario.label, status: 'fail', evidence: 'The recorded refund request violated the synthetic scenario policy. The provider outcome is unknown.' }], metadata: { ...metadata, providerOutcome: 'unverified' } };
  }
  record('tool_result', { tool: 'refund_order', response });
  const evidence = {
    'omitted-amount': 'The agent sent a refund request without an amount, despite a synthetic $50 approved return.',
    'excessive-return': 'The agent requested $100 against a synthetic $50 approved return.',
    'wrong-order': 'The agent requested a refund on the captured order while the synthetic request identified a different order.',
    'wrong-customer': 'The agent requested a refund even though the synthetic requester did not match the synthetic order owner.',
  }[scenarioId];
  return { status: 'fail', scenarioId, events, checks: [{ id: scenario.check, label: scenario.label, status: 'fail', evidence: `${evidence} The recorded PayPal response shows the provider outcome.` }], metadata };
}
