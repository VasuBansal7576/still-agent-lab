import { generateAccountPersonas } from './personas.mjs';

const safeId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value);
const safeCode = (value) => typeof value === 'string' && /^[A-Z0-9_]{1,50}$/.test(value) ? value : null;
const reportAmount = (amount) => amount && typeof amount.value === 'string' && /^-?\d{1,8}\.\d{2}$/.test(amount.value) && /^[A-Z]{3}$/.test(amount.currency_code) ? { value: amount.value, currency_code: amount.currency_code } : null;
const refundCodes = new Set(['T1107', 'T1120']);
const retailPaymentCodes = new Set(['T0000', 'T0005', 'T0006', 'T0007', 'T0011', 'T0012', 'T0018', 'T0019']);

// Keep report windows bounded and discard the entire import if a window cannot be read.
async function readReportWindows(paypal, startDate, endDate) {
  const started = Date.now();
  let requests = 0, windows = 0;
  const maxRequests = 200, maxWindows = 64, deadlineMs = 90000;
  const key = entry => JSON.stringify([entry.id, entry.referenceId, entry.referenceType, entry.eventCode, entry.status, entry.amount, entry.initiatedAt]);
  async function read(start, end) {
    if (++windows > maxWindows) throw new Error('The report exceeds the 64-window import limit; choose a shorter time range.');
    const windowStart = new Date(start).toISOString(), windowEnd = new Date(end).toISOString();
    const rows = [];
    let page = 1, pages = null;
    do {
      if (++requests > maxRequests || Date.now() - started > deadlineMs) throw new Error('The report exceeded the bounded request or time limit; choose a shorter time range.');
      const response = await paypal.listAccountTransactions({ startDate: windowStart, endDate: windowEnd, page });
      if (!response.ok) {
        const codes = Array.isArray(response.errorCodes) ? response.errorCodes : [];
        if (page === 1 && codes.includes('RESULTSET_TOO_LARGE') && end - start > 1) {
          const midpoint = start + Math.floor((end - start) / 2);
          const left = await read(start, midpoint), right = await read(midpoint, end);
          const leftCounts = new Map(), rightCounts = new Map();
          for (const row of left) leftCounts.set(key(row), (leftCounts.get(key(row)) || 0) + 1);
          for (const row of right) rightCounts.set(key(row), (rightCounts.get(key(row)) || 0) + 1);
          const skip = new Map();
          for (const [signature, amount] of leftCounts) {
            if (!rightCounts.has(signature)) continue;
            const row = left.find(item => key(item) === signature);
            if (amount !== rightCounts.get(signature) || Date.parse(row.initiatedAt) !== midpoint) throw new Error('Overlapping report windows could not be matched safely. Import remains unverified.');
            skip.set(signature, amount);
          }
          return left.concat(right.filter(row => { const signature = key(row), n = skip.get(signature) || 0; if (!n) return true; skip.set(signature, n - 1); return false; }));
        }
        throw new Error(`PayPal reporting unavailable (HTTP ${response.status}${codes.length ? `, ${codes.join(', ')}` : ''})${codes.includes('RESULTSET_TOO_LARGE') ? '; choose a shorter time range' : ''}`);
      }
      const body = response.body;
      if (!body || !Array.isArray(body.transactions) || !Number.isSafeInteger(body.totalPages) || body.totalPages < 0 || (body.totalPages === 0 && body.transactions.length)) throw new Error('Report shape or pagination is invalid.');
      if (pages !== null && pages !== body.totalPages) throw new Error('Report pagination changed during import.');
      pages = body.totalPages;
      if (pages > 100) throw new Error('A report window exceeds the 100-page limit; choose a shorter time range.');
      rows.push(...body.transactions.map((entry, index) => ({ ...entry, reportPage: page, reportRow: index + 1, reportWindowStart: windowStart, reportWindowEnd: windowEnd })));
      if (page >= pages) break;
      page++;
    } while (page <= 100);
    return rows;
  }
  const records = await read(Date.parse(startDate), Date.parse(endDate));
  return { records, requests, windows };
}

// Account facts are separated from synthetic scenario assumptions.
export async function importSandboxAccountPersonas({ paypal, startDate, endDate, count, seed = 'still-account', includeDisputes = true } = {}) {
  if (typeof includeDisputes !== 'boolean') throw new TypeError('includeDisputes must be boolean');
  if (!paypal || typeof paypal.listAccountTransactions !== 'function' || typeof paypal.listAccountDisputes !== 'function' || typeof paypal.getAccountDispute !== 'function') throw new TypeError('A PayPal sandbox client is required');
  const transactions = [];
  const disputes = [];
  const evidence = {
    transactions: { status: 'unverified', reason: 'not retrieved' },
    disputes: { status: 'unverified', reason: 'not retrieved' },
  };
  try {
    const report = await readReportWindows(paypal, startDate, endDate);
    transactions.push(...report.records);
    evidence.transactions = transactions.length
      ? { status: 'retrieved', windows: report.windows, requests: report.requests, reason: 'Report retrieved; recent transactions may not yet be reported' }
      : { status: 'unverified', windows: report.windows, requests: report.requests, reason: 'Report is empty or delayed' };
  } catch (error) {
    evidence.transactions.reason = error?.message?.startsWith('PayPal reporting unavailable') || /^(The report|A report window|Report shape|Report pagination|Overlapping report)/.test(error?.message || '') ? error.message : 'Report retrieval failed or the date range is invalid';
  }
  if (includeDisputes) try {
    const listed = [], seenIds = new Set(), seenTokens = new Set();
    let token, pages = 0, incomplete = false, reason = null;
    do {
      const response = await paypal.listAccountDisputes(token ? { nextPageToken: token } : undefined);
      if (!response.ok) { incomplete = true; reason = `PayPal disputes unavailable (HTTP ${response.status})`; break; }
      const body = response.body;
      if (!body || !Array.isArray(body.disputes) || typeof body.hasNext !== 'boolean' || (body.hasNext && (typeof body.nextPageToken !== 'string' || !body.nextPageToken || seenTokens.has(body.nextPageToken)))) { incomplete = true; reason = 'Dispute listing shape or pagination is invalid'; break; }
      pages++;
      for (const item of body.disputes) {
        if (!item || !safeId(item.id)) { incomplete = true; continue; }
        if (!seenIds.has(item.id)) { seenIds.add(item.id); listed.push(item.id); }
      }
      if (!body.hasNext) { token = undefined; break; }
      token = body.nextPageToken; seenTokens.add(token);
      if (pages >= 10) { incomplete = true; reason = 'Dispute listing exceeds the 10-page import limit'; break; }
    } while (token);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, listed.length) }, async () => {
      while (next < listed.length) {
        const id = listed[next++];
        try {
          const detail = await paypal.getAccountDispute(id);
          if (!detail.ok || !detail.body || detail.body.id !== id || !Array.isArray(detail.body.sellerTransactionIds) || detail.body.sellerTransactionIds.some((value) => !safeId(value))) { incomplete = true; continue; }
          disputes.push({ id, status: safeCode(detail.body.status), amount: reportAmount(detail.body.amount), sellerTransactionIds: detail.body.sellerTransactionIds.filter(safeId) });
        } catch { incomplete = true; }
      }
    }));
    evidence.disputes = { status: 'unverified', pagesRetrieved: pages, listed: listed.length, detailsRetrieved: disputes.length, reason: reason || (incomplete ? 'Dispute listing or details incomplete' : 'Listing retrieved; account-wide absence and provider visibility remain unverified') };
  } catch {
    evidence.disputes.reason = 'Dispute retrieval failed';
  }
  else evidence.disputes.reason = 'Not requested; no dispute records were retrieved';

  const eligible = evidence.transactions.status === 'retrieved' ? transactions.filter((entry) => safeId(entry.id) && retailPaymentCodes.has(entry.eventCode) && entry.status === 'S' && entry.amount && /^[A-Z]{3}$/.test(entry.amount.currency_code) && /^\d{1,8}\.\d{2}$/.test(entry.amount.value) && Number(entry.amount.value) >= 0.02) : [];
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
      transaction: { id: entry.id, status: safeCode(entry.status), eventCode: safeCode(entry.eventCode), amount: entry.amount, orderId, initiatedAt: typeof entry.initiatedAt === 'string' && Number.isFinite(Date.parse(entry.initiatedAt)) ? entry.initiatedAt : null, reportWindowStart: entry.reportWindowStart, reportWindowEnd: entry.reportWindowEnd, reportPage: entry.reportPage, reportRow: entry.reportRow },
      relatedTransactions: related.map((item) => ({ id: item.id, eventCode: safeCode(item.eventCode), status: safeCode(item.status), amount: reportAmount(item.amount), reportWindowStart: item.reportWindowStart, reportWindowEnd: item.reportWindowEnd, reportPage: item.reportPage, reportRow: item.reportRow, relationship: 'report references transaction ID', classification: refundCodes.has(item.eventCode) ? 'payment refund event' : 'other or unknown event' })),
      disputes: linkedDisputes.map(({ id, status, amount }) => ({ id, status, amount, relationship: 'dispute detail references seller transaction ID' })),
      disputeState: linkedDisputes.length ? 'linked records retrieved; inspect statuses' : 'unverified',
    };
    personas[i].scenarioAssumptions = 'Synthetic request, mutation, customer and order identifiers, approved return and dispute state; these are not account facts.';
  }
  return { personas, evidence, importedTransactions: eligible.length, importedDisputes: disputes.length };
}
