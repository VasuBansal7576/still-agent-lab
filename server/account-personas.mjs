import { generateAccountPersonas } from './personas.mjs';

const safeId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value);
const safeCode = (value) => typeof value === 'string' && /^[A-Z0-9_]{1,50}$/.test(value) ? value : null;

// Account facts are separated from synthetic scenario assumptions.
export async function importSandboxAccountPersonas({ paypal, startDate, endDate, count, seed = 'still-account' } = {}) {
  if (!paypal || typeof paypal.listAccountTransactions !== 'function' || typeof paypal.listAccountDisputes !== 'function' || typeof paypal.getAccountDispute !== 'function') throw new TypeError('A PayPal sandbox client is required');
  const transactions = [];
  const disputes = [];
  const evidence = {
    transactions: { status: 'unverified', reason: 'not retrieved' },
    disputes: { status: 'unverified', reason: 'not retrieved' },
  };
  try {
    let page = 1;
    let pages = null;
    do {
      const response = await paypal.listAccountTransactions({ startDate, endDate, page });
      if (!response.ok) { evidence.transactions.reason = `PayPal reporting unavailable (HTTP ${response.status})`; break; }
      const body = response.body;
      if (!body || !Array.isArray(body.transactions) || !Number.isSafeInteger(body.totalPages) || body.totalPages < 0 || (body.totalPages === 0 && body.transactions.length)) { evidence.transactions.reason = 'Report shape or pagination is invalid'; break; }
      if (pages !== null && pages !== body.totalPages) { evidence.transactions.reason = 'Report pagination changed during import'; break; }
      pages = body.totalPages;
      transactions.push(...body.transactions.map((entry, index) => ({ ...entry, reportPage: page, reportRow: index + 1 })));
      if (pages > 100) { evidence.transactions.reason = 'Report exceeds the 100-page import limit'; break; }
      if (page >= pages) {
        evidence.transactions = transactions.length
          ? { status: 'retrieved', reason: 'Report retrieved; recent transactions may not yet be reported' }
          : { status: 'unverified', reason: 'Report is empty or delayed' };
        break;
      }
      page++;
    } while (page <= 100);
  } catch {
    evidence.transactions.reason = 'Report retrieval failed or the date range is invalid';
  }
  try {
    const response = await paypal.listAccountDisputes();
    if (!response.ok) evidence.disputes.reason = `PayPal disputes unavailable (HTTP ${response.status})`;
    else if (!response.body || !Array.isArray(response.body.disputes) || typeof response.body.hasNext !== 'boolean') evidence.disputes.reason = 'Dispute listing shape or pagination is unknown';
    else {
      let incomplete = response.body.hasNext;
      for (const item of response.body.disputes) {
        if (!item || !safeId(item.id)) { incomplete = true; continue; }
        const detail = await paypal.getAccountDispute(item.id);
        if (!detail.ok || !detail.body || detail.body.id !== item.id || !Array.isArray(detail.body.sellerTransactionIds) || detail.body.sellerTransactionIds.some((id) => !safeId(id))) { incomplete = true; continue; }
        disputes.push({ id: item.id, status: safeCode(detail.body.status), sellerTransactionIds: detail.body.sellerTransactionIds.filter(safeId) });
      }
      evidence.disputes = { status: 'unverified', reason: incomplete ? 'Dispute listing or details incomplete' : 'No absence of a dispute can be established from this import' };
    }
  } catch {
    evidence.disputes.reason = 'Dispute retrieval failed';
  }

  const eligible = evidence.transactions.status === 'retrieved' ? transactions.filter((entry) => safeId(entry.id) && entry.amount && /^[A-Z]{3}$/.test(entry.amount.currency_code) && /^\d{1,8}\.\d{2}$/.test(entry.amount.value) && Number(entry.amount.value) >= 0.02) : [];
  const records = eligible.map((entry) => {
    const amountCents = Math.round(Number(entry.amount.value) * 100);
    return { recordId: entry.id, amount: entry.amount.value, currency: entry.amount.currency_code, approvedReturn: (Math.floor(amountCents / 2) / 100).toFixed(2), disputeOpen: false };
  });
  const actualCount = count === undefined ? records.length : count;
  if (!Number.isSafeInteger(actualCount) || actualCount < 0 || actualCount > 100000) throw new RangeError('count must be an integer from 0 to 100000');
  if (!records.length) return { personas: [], evidence, importedTransactions: 0, importedDisputes: disputes.length };
  const personas = generateAccountPersonas({ records, count: actualCount, seed });
  for (let i = 0; i < personas.length; i++) {
    const entry = eligible[i % eligible.length];
    const related = transactions.filter((other) => safeId(other.id) && other.referenceType === 'TXN' && other.referenceId === entry.id);
    const linkedDisputes = disputes.filter((dispute) => dispute.sellerTransactionIds.includes(entry.id));
    const orderId = entry.referenceType === 'ODR' && safeId(entry.referenceId) ? entry.referenceId : null;
    personas[i].source = {
      dataset: 'PayPal sandbox account transaction report', recordId: entry.id,
      recordIds: [entry.id, ...(orderId ? [orderId] : []), ...related.map((item) => item.id), ...linkedDisputes.map((item) => item.id)],
      license: 'Account owner supplied; not a public dataset', url: null,
    };
    personas[i].accountEvidence = {
      transaction: { id: entry.id, status: safeCode(entry.status), eventCode: safeCode(entry.eventCode), amount: entry.amount, orderId, initiatedAt: typeof entry.initiatedAt === 'string' && Number.isFinite(Date.parse(entry.initiatedAt)) ? entry.initiatedAt : null, reportPage: entry.reportPage, reportRow: entry.reportRow },
      relatedTransactions: related.map((item) => ({ id: item.id, eventCode: safeCode(item.eventCode), status: safeCode(item.status), amount: item.amount && typeof item.amount.value === 'string' && /^-?\d{1,8}\.\d{2}$/.test(item.amount.value) && /^[A-Z]{3}$/.test(item.amount.currency_code) ? item.amount : null })),
      disputes: linkedDisputes.map(({ id, status }) => ({ id, status })),
      disputeState: linkedDisputes.length ? 'linked records retrieved; inspect statuses' : 'unverified',
    };
    personas[i].scenarioAssumptions = 'Synthetic request, mutation, customer and order identifiers, approved return and dispute state; these are not account facts.';
  }
  return { personas, evidence, importedTransactions: eligible.length, importedDisputes: disputes.length };
}
