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

async function verifyDispute(paypal, id, capture) {
  if (!safeId(id)) return null;
  if (capture.verification !== 'verified') return { id, verification: 'unverified', reason: 'Capture was not verified.' };
  if (typeof paypal.getAccountDispute !== 'function') return { id, verification: 'unverified', reason: 'Dispute lookup is unavailable.' };
  try {
    const result = await paypal.getAccountDispute(id);
    const body = result?.body;
    const status = code(body?.status);
    if (result?.ok === true && result.status === 200 && body?.id === id && status && Array.isArray(body.sellerTransactionIds) && body.sellerTransactionIds.includes(capture.id)) {
      return { id, verification: 'verified', httpStatus: 200, status, amount: amount(body.amount), relationship: 'PayPal dispute detail names the verified capture as a seller transaction.' };
    }
    return { id, verification: 'unverified', reason: 'Provider detail did not confirm this dispute and its relationship to the capture.', httpStatus: Number.isInteger(result?.status) ? result.status : null };
  } catch {
    return { id, verification: 'unverified', reason: 'Provider dispute lookup failed.', httpStatus: null };
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
    const dispute = await verifyDispute(paypal, run.metadata.disputeId, capture);
    records.push({ runId: run.id, capture, refunds, dispute, relationship: 'The saved run associates these refund responses with this capture; the provider lookup does not independently verify that relationship.', history: 'unverified', disputeState: dispute?.verification === 'verified' ? 'linked dispute retrieved; account-wide coverage unverified' : 'unverified' });
  }
  const eligible = records.filter(record => record.capture.verification === 'verified' && Number(record.capture.amount.value) >= 0.02);
  const requested = count ?? eligible.length;
  const bases = eligible.map(({ capture }) => ({ recordId: capture.id, amount: capture.amount.value, currency: capture.amount.currency_code, approvedReturn: (Math.floor(Number(capture.amount.value) * 100 / 2) / 100).toFixed(2), disputeOpen: false }));
  const personas = bases.length ? generateAccountPersonas({ records: bases, count: requested, seed }) : [];
  for (let i = 0; i < personas.length; i++) {
    const record = eligible[i % eligible.length];
    personas[i].source = { dataset: 'PayPal sandbox records identified by saved Still runs', recordId: record.capture.id, recordIds: [record.capture.id, ...record.refunds.filter(refund => refund.verification === 'verified').map(refund => refund.id), ...(record.dispute?.verification === 'verified' ? [record.dispute.id] : [])], runId: record.runId, license: 'Account owner supplied; not a public dataset', url: null };
    personas[i].accountEvidence = record;
    personas[i].scenarioAssumptions = 'Customer, request, order, approved return and scenario dispute state are synthetic. Provider lookups do not establish complete refund history or account-wide dispute coverage.';
  }
  return { personas, records, coverage: { source: 'saved Still sandbox runs only', history: 'unverified', disputeState: 'unverified', runLimit: 100, eligibleCaptures: eligible.length } };
}
