import { listRuns, readRun } from './store.mjs';
import { generateAccountPersonas } from './personas.mjs';

const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value) && !/^MOCK-/i.test(value);
const amount = value => value && typeof value.value === 'string' && /^(?:0|[1-9]\d{0,7})\.\d{2}$/.test(value.value) && /^[A-Z]{3}$/.test(value.currency_code || '') ? { value: value.value, currency_code: value.currency_code } : null;
const code = value => typeof value === 'string' && /^[A-Z_]{1,50}$/.test(value) ? value : null;

async function verify(read, id) {
  try {
    const result = await read(id);
    const body = result?.body;
    const safeAmount = amount(body?.amount);
    const status = code(body?.status);
    if (result?.ok === true && result.status === 200 && body?.id === id && safeAmount && status) {
      return { id, verification: 'verified', httpStatus: 200, status, amount: safeAmount };
    }
    return { id, verification: 'unverified', reason: 'Provider response did not confirm the identifier, status and amount.', httpStatus: Number.isInteger(result?.status) ? result.status : null };
  } catch {
    return { id, verification: 'unverified', reason: 'Provider lookup failed.', httpStatus: null };
  }
}

// Only server-owned runs supply identifiers. No caller-provided IDs or paths are read.
export async function importVerifiedAccountPersonas({ paypal, count, seed = 'still-account-runs' } = {}) {
  if (!paypal || typeof paypal.getCapture !== 'function' || typeof paypal.getRefund !== 'function') throw new TypeError('A connected PayPal sandbox adapter is required');
  if (count !== undefined && (!Number.isSafeInteger(count) || count < 0 || count > 100000)) throw new RangeError('count must be an integer from 0 to 100000');
  const summaries = (await listRuns()).slice(0, 100);
  const records = [];
  for (const summary of summaries) {
    const run = await readRun(summary.id);
    if (!run || run.id !== summary.id || run.metadata?.provider !== 'paypal-sandbox' || !Array.isArray(run.events) || run.events.length > 1000) continue;
    const captures = [...new Set(run.events.filter(event => event?.type === 'capture' && event.response?.ok === true && safeId(event.response?.body?.id)).map(event => event.response.body.id))];
    // The trace association is only usable when the run identifies exactly one capture.
    if (captures.length !== 1) continue;
    const refundIds = [...new Set(run.events.filter(event => event?.type === 'tool_result' && event.tool === 'refund_order' && event.response?.ok === true && safeId(event.response?.body?.id)).map(event => event.response.body.id))].slice(0, 100);
    const capture = await verify(id => paypal.getCapture(id), captures[0]);
    const refunds = [];
    for (const id of refundIds) refunds.push(await verify(value => paypal.getRefund(value), id));
    records.push({ runId: run.id, capture, refunds, relationship: 'The saved run associates these refund responses with this capture; the provider lookup does not independently verify that relationship.', history: 'unverified', disputeState: 'unverified' });
  }
  const eligible = records.filter(record => record.capture.verification === 'verified' && Number(record.capture.amount.value) >= 0.02);
  const requested = count ?? eligible.length;
  const bases = eligible.map(({ capture }) => ({ recordId: capture.id, amount: capture.amount.value, currency: capture.amount.currency_code, approvedReturn: (Math.floor(Number(capture.amount.value) * 100 / 2) / 100).toFixed(2), disputeOpen: false }));
  const personas = bases.length ? generateAccountPersonas({ records: bases, count: requested, seed }) : [];
  for (let i = 0; i < personas.length; i++) {
    const record = eligible[i % eligible.length];
    personas[i].source = { dataset: 'PayPal sandbox records identified by saved Still runs', recordId: record.capture.id, recordIds: [record.capture.id, ...record.refunds.filter(refund => refund.verification === 'verified').map(refund => refund.id)], runId: record.runId, license: 'Account owner supplied; not a public dataset', url: null };
    personas[i].accountEvidence = record;
    personas[i].scenarioAssumptions = 'Customer, request, order, approved return and dispute state are synthetic. The provider lookups do not establish complete refund history or dispute state.';
  }
  return { personas, records, coverage: { source: 'saved Still sandbox runs only', history: 'unverified', disputeState: 'unverified', runLimit: 100, eligibleCaptures: eligible.length } };
}
