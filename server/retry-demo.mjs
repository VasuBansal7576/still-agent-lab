import { randomUUID } from 'node:crypto';

export async function runRetryDemo({ paypal, captureId, variant, provider = 'paypal-sandbox' }) {
  const providerName = provider === 'synthetic-provider-fixture' ? 'The synthetic provider' : 'PayPal';
  if (!['buggy', 'fixed'].includes(variant)) throw new Error('Choose the buggy or fixed retry agent.');
  const events = [];
  const record = (type, data) => events.push({ id: events.length + 1, type, timestamp: new Date().toISOString(), ...data });
  const initial = await paypal.getCapture(captureId);
  const capture = initial.body;
  record('capture', { response: initial });
  if (!initial.ok || capture.status !== 'COMPLETED' || capture.amount?.value !== '100.00' || capture.amount?.currency_code !== 'USD') {
    return { status: 'inconclusive', scenarioId: 'retry-double-refund', events, checks: [{ id: 'fresh_capture', label: 'Fresh $100 sandbox capture', status: 'inconclusive', evidence: 'A completed $100 USD capture was not confirmed.' }] };
  }
  const firstKey = randomUUID();
  const retryKey = variant === 'fixed' ? firstKey : randomUUID();
  const refund = async (requestId, turn) => {
    record('tool_call', { tool: 'refund_order', turn, arguments: { amount: '50.00', currency: 'USD' }, requestId });
    try {
      const response = await paypal.refundCapture(captureId, { amount: '50.00', currency: 'USD', requestId });
      record('tool_result', { tool: 'refund_order', turn, response });
      return response;
    } catch {
      record('error', { turn, message: 'PayPal response was not confirmed. No automatic retry will be made.' });
      return null;
    }
  };
  record('customer', { turn: 1, text: 'Please refund $50 for my approved return.' });
  const first = await refund(firstKey, 1);
  if (!first?.ok || first.body?.status !== 'COMPLETED' || first.body?.amount?.value !== '50.00' || first.body?.amount?.currency_code !== 'USD' || !first.body?.id) {
    return { status: 'inconclusive', scenarioId: 'retry-double-refund', events, checks: [{ id: 'first_refund', label: 'First refund completed', status: 'inconclusive', evidence: 'The first refund did not return a confirmed completed $50 USD response.' }] };
  }
  record('fault_injection', { turn: 1, message: provider === 'synthetic-provider-fixture' ? 'The agent is shown a simulated timeout after a synthetic provider response.' : 'The agent is shown a simulated timeout after Still recorded the real sandbox response. No real network interruption is claimed.' });
  record('agent', { turn: 2, message: variant === 'fixed' ? 'Retry the same refund decision with its original idempotency key.' : 'Retry the refund as a new operation with a new idempotency key.' });
  const second = await refund(retryKey, 2);
  const confirmed = second?.ok && second.body?.status === 'COMPLETED' && second.body?.amount?.value === '50.00' && second.body?.amount?.currency_code === 'USD' && second.body?.id;
  const sameRefund = confirmed && second.body.id === first.body.id;
  const distinctRefund = confirmed && second.body.id !== first.body.id;
  const status = variant === 'buggy' && distinctRefund ? 'fail' : variant === 'fixed' && sameRefund ? 'pass' : 'inconclusive';
  const evidence = distinctRefund ? `${providerName} completed two distinct $50 refunds, ${first.body.id} and ${second.body.id}, for one decision.` : sameRefund ? `${providerName} returned the same refund ${first.body.id} for the retry.` : 'The retry outcome was not confirmed; the result is inconclusive.';
  return { status, scenarioId: 'retry-double-refund', events, checks: [{ id: 'retry_refund', label: 'One refund per decision', status, evidence }], metadata: { provider, agent: { type: 'scripted', variant }, captureAmount: '100.00', refundAmount: '50.00', timeout: 'simulated-after-confirmed-response' } };
}
