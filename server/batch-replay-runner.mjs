import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPayPalSandbox } from './paypal.mjs';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';
import { replayCheckoutAmount } from './replay-checkout.mjs';
import { replayFailureSpec } from './replay-dispute.mjs';
import { createReplayLedger } from './replay-ledger.mjs';
import { planSandboxReplays, reconcileSandboxReplays } from './sandbox-replay.mjs';
import { passingReplaySpec } from './replay-passing-spec.mjs';

const base = 'https://api-m.sandbox.paypal.com';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = value => createHash('sha256').update(value).digest('hex');

async function writeClaim(directory, key) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `${digest(key)}.json`);
  try {
    const handle = await open(file, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify({ key, state: 'reserved', createdAt: new Date().toISOString() })); await handle.sync(); }
    finally { await handle.close(); }
    return file;
  } catch (error) { if (error.code === 'EEXIST') return null; throw error; }
}

async function addClaim(file, record) {
  const handle = await open(file, 'a', 0o600);
  try { await handle.writeFile(`\n${JSON.stringify(record)}`); await handle.sync(); }
  finally { await handle.close(); }
}

async function tokenFor(credentials) {
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.access_token !== 'string') throw new Error(`Sandbox authentication failed (HTTP ${response.status}).`);
  return result.access_token;
}

export async function replaySandboxCredentials() {
  if (process.env.STILL_REPLAY_USE_ENV_CREDENTIALS === '1') {
    const { PAYPAL_CLIENT_ID: clientId, PAYPAL_CLIENT_SECRET: clientSecret } = process.env;
    if (!/^[A-Za-z0-9_-]{10,256}$/.test(clientId || '') || !/^[A-Za-z0-9_-]{10,256}$/.test(clientSecret || '')) throw new Error('Both isolated PayPal sandbox environment credentials are required.');
    return { clientId, clientSecret };
  }
  const credentials = await loadSandboxCredentials();
  if (!credentials) throw new Error('Connect a PayPal sandbox account before reserving a fresh replay.');
  return credentials;
}

export async function authenticateReplaySandbox(credentials) {
  await tokenFor(credentials);
}

async function captureWithTestCard(token, amount, currency, requestId) {
  const response = await fetch(`${base}/v2/checkout/orders`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': requestId, Prefer: 'return=representation' },
    body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: currency, value: amount } }],
      payment_source: { card: { number: '4005519200000004', expiry: '2030-12', security_code: '123', name: 'Test Buyer', billing_address: { address_line_1: '123 Main St', admin_area_1: 'CA', admin_area_2: 'San Jose', postal_code: '95131', country_code: 'US' } } } }),
  });
  const body = await response.json().catch(() => ({}));
  const captures = (body.purchase_units || []).flatMap(unit => unit.payments?.captures || []);
  const capture = captures[0];
  return { ok: response.ok && body.status === 'COMPLETED' && captures.length === 1 && capture?.status === 'COMPLETED' && capture.amount?.currency_code === currency && capture.amount?.value === amount,
    http: response.status, orderId: body.id, captureId: capture?.id, orderStatus: body.status, captureStatus: capture?.status, amount: capture?.amount,
    name: body.name, issues: Array.isArray(body.details) ? body.details.map(item => item.issue).filter(Boolean) : [] };
}

async function createSandboxChargeback(token, adapter, captureId, amount, currency) {
  const captureResponse = await fetch(`${base}/v2/payments/captures/${captureId}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  const capture = await captureResponse.json().catch(() => ({}));
  if (!captureResponse.ok || capture.id !== captureId || capture.status !== 'COMPLETED' || capture.amount?.value !== amount || capture.amount?.currency_code !== currency || !/^[A-Za-z0-9_-]{1,127}$/.test(capture.payee?.merchant_id || '')) return { ok: false, http: captureResponse.status, reason: 'Sandbox capture or merchant could not be confirmed.' };
  const now = new Date(), later = new Date(now.getTime() + 14 * 86400000);
  const simulatorReference = BigInt(`0x${digest(captureId).slice(0, 20)}`).toString().padStart(25, '0');
  const response = await fetch(`${base}/v2/customer-support/process-chargeback`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ adjacency: 'PAYPAL', file_layout: 'ATCK_CB', merchant_id: capture.payee.merchant_id, financial_institution: { processor: 'FDMS' }, transaction: { id_enc: captureId, amount: { currency_code: currency, value: amount } }, instrument: { instrument_type: 'CARD', card_brand: 'VISA', credit_card_transaction_id: simulatorReference.slice(-16), external: false }, dispute: { id: null, stage: 'CHARGEBACK', response_date: later.toISOString(), status: '2', amount: { currency_code: currency, value: amount }, receive_date: now.toISOString(), event_code: 'CHARGEBACK_INITIATED', money_movement_date: now.toISOString(), event_type: 'DEBIT', chargeback_type: 'REPORTED_TO_PROCESSOR', processor_info: { reference_number: simulatorReference, reason_code: '1330', notes: 'SANDBOX_TEST' } } }) });
  const body = await response.json().catch(() => ({}));
  let disputeId = body.id;
  if (response.status !== 201) return { ok: false, http: response.status, reason: 'PayPal did not confirm a sandbox chargeback request.', name: body.name, issues: body.details?.map(item => item.issue) };
  if (!/^[A-Za-z0-9_-]{1,127}$/.test(disputeId || '')) {
    for (let attempt = 0; attempt < 10 && !disputeId; attempt++) {
      const query = new URLSearchParams({ disputed_transaction_id: captureId, page_size: '50' });
      const listResponse = await fetch(`${base}/v1/customer/disputes?${query}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
      const list = await listResponse.json().catch(() => ({}));
      if (!listResponse.ok || !Array.isArray(list.items) || list.links?.some(link => link.rel === 'next')) break;
      const ids = list.items.map(item => item.dispute_id).filter(id => /^[A-Za-z0-9_-]{1,127}$/.test(id || ''));
      if (ids.length === 1) disputeId = ids[0];
      if (ids.length > 1) break;
      if (!disputeId) await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  if (!/^[A-Za-z0-9_-]{1,127}$/.test(disputeId || '')) return { ok: false, http: response.status, reason: 'PayPal accepted the sandbox chargeback, but its ID could not be uniquely verified.' };
  const detail = await adapter.getAccountDispute(disputeId);
  if (!detail.ok || !['OPEN', 'UNDER_REVIEW', 'WAITING_FOR_SELLER_RESPONSE', 'WAITING_FOR_BUYER_RESPONSE'].includes(detail.body?.status) || !Array.isArray(detail.body.sellerTransactionIds) || detail.body.sellerTransactionIds.length !== 1 || detail.body.sellerTransactionIds[0] !== captureId) return { ok: false, http: detail.status, disputeId, reason: 'PayPal did not confirm an unresolved dispute for this capture.' };
  return { ok: true, http: response.status, disputeId, status: detail.body.status, captureId, scenario: 'sandbox-card-chargeback-not-wallet-inquiry' };
}

export async function createSandboxTestCardCapture({ amount, currency, credentials, requestId = randomUUID() } = {}) {
  if (!/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(amount || '') || Number(amount) <= 0 || !/^[A-Z]{3}$/.test(currency || '') || !uuid.test(requestId)) throw new TypeError('A positive amount, currency and UUID request ID are required.');
  return captureWithTestCard(await tokenFor(credentials), amount, currency, requestId);
}

export async function resumeConfirmedChargebacks({ batchId, limit = 1 } = {}) {
  if (!uuid.test(batchId || '') || !Number.isSafeInteger(limit) || limit < 1 || limit > 100000) throw new TypeError('A batch UUID and positive limit are required.');
  const batch = JSON.parse(await readFile(new URL(`../.data/batches/${batchId}.json`, import.meta.url), 'utf8'));
  const plan = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses: 10 });
  const items = new Map(plan.queue.map(item => [item.key, item]));
  const credentials = await loadSandboxCredentials(), token = await tokenFor(credentials), adapter = createPayPalSandbox(credentials);
  const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
  const prior = new Set((await ledger.evidence()).map(receipt => receipt.key));
  const directory = join('.data', 'bulk-replay-claims');
  const { readdir } = await import('node:fs/promises');
  const results = [];
  for (const name of await readdir(directory)) {
    if (results.length >= limit) break;
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const file = join(directory, name), lines = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const key = lines[0]?.key, item = items.get(key), captured = lines.find(line => line.state === 'captured');
    if (!item || prior.has(key) || lines.at(-1)?.state !== 'chargeback-unverified' || !captured?.ok || !captured.captureId || !replayFailureSpec(item).disputeRequired) continue;
    const query = new URLSearchParams({ disputed_transaction_id: captured.captureId, page_size: '50' });
    const response = await fetch(`${base}/v1/customer/disputes?${query}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    const body = await response.json().catch(() => ({}));
    const ids = Array.isArray(body.items) ? body.items.map(entry => entry.dispute_id).filter(id => /^[A-Za-z0-9_-]{1,127}$/.test(id || '')) : [];
    if (!response.ok || ids.length !== 1 || body.links?.some(link => link.rel === 'next')) { results.push({ key, status: 'unverified', reason: 'No unique sandbox dispute found.' }); continue; }
    const dispute = await adapter.getAccountDispute(ids[0]);
    if (!dispute.ok || !['OPEN', 'UNDER_REVIEW', 'WAITING_FOR_SELLER_RESPONSE', 'WAITING_FOR_BUYER_RESPONSE'].includes(dispute.body?.status) || !Array.isArray(dispute.body.sellerTransactionIds) || dispute.body.sellerTransactionIds.length !== 1 || dispute.body.sellerTransactionIds[0] !== captured.captureId) { results.push({ key, status: 'unverified', reason: 'PayPal did not verify an unresolved dispute on this capture.' }); continue; }
    try { await mkdir(`${file}.resume`, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    await addClaim(file, { state: 'resume-requested', captureId: captured.captureId, disputeId: ids[0], scenario: 'sandbox-card-chargeback-not-wallet-inquiry' });
    const sessionId = randomUUID();
    const receipt = await ledger.execute({ item, sessionId, adapter, approval: { sessionId, captureId: captured.captureId, funding: 'paypal-sandbox-test-card', disputeId: ids[0], disputeKind: 'sandbox-card-chargeback' } });
    await addClaim(file, { state: 'executed', source: receipt.source, status: receipt.status, reason: receipt.reason });
    const comparison = reconcileSandboxReplays({ plan: { ...plan, queue: [item] }, evidence: [receipt], verifyReceipt: ledger.verifyReceipt });
    results.push({ key, captureId: captured.captureId, disputeId: ids[0], scenario: 'sandbox-card-chargeback-not-wallet-inquiry', comparison: comparison.results[0] });
    if (receipt.reason?.includes('uncertain')) break;
  }
  return { source: 'paypal-sandbox', results };
}

// This runner only loads server-owned batches and cannot be supplied a payment source or endpoint.
export async function runSandboxReplayBatch({ batchId, limit = 1, concurrency = 1, samplePasses = 10, mode = 'all', onProgress = () => {}, replayCredentials } = {}) {
  if (!uuid.test(batchId || '') || !Number.isSafeInteger(limit) || limit < 1 || limit > 100000 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8 || !['all', 'disputes'].includes(mode)) throw new TypeError('Provide a batch UUID, positive limit, concurrency from 1 to 8 and valid mode.');
  const batch = JSON.parse(await readFile(new URL(`../.data/batches/${batchId}.json`, import.meta.url), 'utf8'));
  const plan = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses });
  const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
  const prior = new Set((await ledger.evidence()).map(item => item.key));
  const credentials = replayCredentials || await replaySandboxCredentials();
  const token = await tokenFor(credentials);
  const adapter = createPayPalSandbox(credentials);
  const directory = join('.data', 'bulk-replay-claims');
  const summary = { batchId, total: plan.queueCount, alreadyRecorded: 0, attempted: 0, compared: 0, agreed: 0, disagreed: 0, requiresDispute: 0, unsupported: 0, claimedPreviously: 0, unverified: 0 };
  const candidates = [];
  for (const item of plan.queue) {
    if (prior.has(item.key)) { summary.alreadyRecorded++; continue; }
    if (item.status === 'fail') {
      const spec = replayFailureSpec(item);
      if (spec.reason) { summary.unsupported++; continue; }
      if (mode === 'disputes' && !spec.disputeRequired) continue;
    } else if (mode === 'disputes') {
      continue;
    }
    if (!replayCheckoutAmount(item)) { summary.unsupported++; continue; }
    candidates.push(item);
  }
  let next = 0, stopped = false;
  async function worker() {
    while (!stopped && next < candidates.length && next < limit) {
      const item = candidates[next++];
      const file = await writeClaim(directory, item.key);
      if (!file) { summary.claimedPreviously++; continue; }
      const expected = replayCheckoutAmount(item), requestId = randomUUID();
      summary.attempted++;
      await addClaim(file, { state: 'order-requested', requestId, ...expected });
      let order;
      try { order = await captureWithTestCard(token, expected.amount, expected.currency, requestId); }
      catch { await addClaim(file, { state: 'order-unknown' }); summary.unverified++; stopped = true; continue; }
      await addClaim(file, { state: order.ok ? 'captured' : 'capture-unverified', ...order });
      if (!order.ok) { summary.unverified++; if (order.http === 429 || order.http >= 500 || order.http === 401 || order.http === 403) stopped = true; continue; }
      let disputeId;
      if ((item.status === 'fail' ? replayFailureSpec(item) : passingReplaySpec(item)).disputeRequired) {
        await addClaim(file, { state: 'chargeback-requested', captureId: order.captureId });
        let dispute;
        try { dispute = await createSandboxChargeback(token, adapter, order.captureId, expected.amount, expected.currency); }
        catch { await addClaim(file, { state: 'chargeback-unknown' }); summary.unverified++; stopped = true; continue; }
        await addClaim(file, { state: dispute.ok ? 'chargeback-confirmed' : 'chargeback-unverified', ...dispute });
        if (!dispute.ok) { summary.unverified++; if (!dispute.http || dispute.http === 429 || dispute.http >= 500 || dispute.http === 401 || dispute.http === 403) stopped = true; continue; }
        disputeId = dispute.disputeId;
      }
      const sessionId = randomUUID();
      const receipt = await ledger.execute({ item, sessionId, adapter, approval: { sessionId, captureId: order.captureId, funding: 'paypal-sandbox-test-card', disputeId, ...(disputeId ? { disputeKind: 'sandbox-card-chargeback' } : {}) } });
      await addClaim(file, { state: 'executed', source: receipt.source, status: receipt.status, reason: receipt.reason });
      const comparison = reconcileSandboxReplays({ plan: { ...plan, queue: [item] }, evidence: [receipt], verifyReceipt: ledger.verifyReceipt });
      summary.compared += comparison.compared; summary.agreed += comparison.agreed; summary.disagreed += comparison.disagreed;
      if (!comparison.compared) summary.unverified++;
      if (receipt.reason?.includes('uncertain') || receipt.attempts?.some(attempt => attempt.refund?.status === 429 || attempt.refund?.status >= 500 || attempt.refund?.status === 401 || attempt.refund?.status === 403)) stopped = true;
      onProgress({ index: next, ...summary });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, limit) }, worker));
  return { ...summary, stopped, remaining: Math.max(0, candidates.length - next), provenance: 'paypal-sandbox', funding: 'paypal-sandbox-test-card' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [batchId, count = '1', workers = '1', mode = 'all'] = process.argv.slice(2);
  try { const result = mode === 'resume-chargebacks' ? await resumeConfirmedChargebacks({ batchId, limit: Number(count) }) : await runSandboxReplayBatch({ batchId, limit: Number(count), concurrency: Number(workers), mode, onProgress: result => { if (result.attempted % 25 === 0) console.log(JSON.stringify(result)); } }); console.log(JSON.stringify(result)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
