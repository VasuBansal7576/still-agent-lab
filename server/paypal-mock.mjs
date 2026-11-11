const money = value => {
  const text = String(value ?? '');
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
};
const format = cents => (cents / 100).toFixed(2);

/** Isolated, deterministic simulation. Responses are not PayPal sandbox evidence. */
export function createPayPalMock(scenario, runId = 'run') {
  const total = money(scenario.amount);
  if (total === null || total <= 0 || !/^[A-Z]{3}$/.test(scenario.currency || '')) throw new Error('Scenario needs a positive amount and a three-letter currency.');
  const captureId = `MOCK-CAPTURE-${runId}`;
  const state = { captureId, status: /failed|unpaid/i.test(scenario.kind || '') ? 'FAILED' : 'COMPLETED', total, refunded: 0, refunds: [], requests: new Map(), timeoutUsed: false };
  const provenance = { source: 'deterministic-mock', sandboxVerified: false };
  const capture = () => ({ id: captureId, status: state.status, amount: { value: format(total), currency_code: scenario.currency }, refunded: format(state.refunded), refunds: state.refunds.map(r => ({ ...r })), provenance });
  const getDispute = () => ({ status: scenario.disputeOpen ? 'OPEN' : 'NONE', provenance });
  function refund({ amount, currency = scenario.currency, requestId, captureId: requestedCapture = captureId } = {}) {
    const requested = amount == null ? total - state.refunded : money(amount);
    const signature = JSON.stringify({ amount: amount ?? null, currency, captureId: requestedCapture });
    if (requestId && state.requests.has(requestId)) {
      const prior = state.requests.get(requestId);
      if (prior.signature !== signature) return { ok: false, status: 422, body: { name: 'IDEMPOTENCY_CONFLICT' }, provenance };
      return { ...prior.response, replayed: true };
    }
    const error = issue => ({ ok: false, status: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue }] }, provenance });
    let response;
    if (requestedCapture !== captureId) response = error('CAPTURE_NOT_FOUND');
    else if (state.status !== 'COMPLETED') response = error('CAPTURE_NOT_COMPLETED');
    else if (state.refunded === total) response = error('CAPTURE_FULLY_REFUNDED');
    else if (requested === null || requested <= 0 || currency !== scenario.currency) response = error('INVALID_AMOUNT_OR_CURRENCY');
    else if (requested > total - state.refunded) response = error('REFUND_AMOUNT_EXCEEDED');
    else {
      const body = { id: `MOCK-REFUND-${runId}-${state.refunds.length + 1}`, status: 'COMPLETED', amount: { value: format(requested), currency_code: currency } };
      state.refunded += requested;
      state.refunds.push(body);
      response = { ok: true, status: 201, body, provenance };
    }
    if (requestId) state.requests.set(requestId, { signature, response });
    if (response.ok && !state.timeoutUsed && /timeout|retry/i.test(scenario.kind || '')) {
      state.timeoutUsed = true;
      return { ok: false, status: null, error: 'TIMEOUT_OUTCOME_UNKNOWN', provenance };
    }
    return response;
  }
  return { getCapture: capture, getDispute, refund, snapshot: capture, provenance };
}
export { money as parseMoney, format as formatMoney };
