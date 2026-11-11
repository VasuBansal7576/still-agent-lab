import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';
import { createPayPalSandbox } from './paypal.mjs';
import { createReplayLedger } from './replay-ledger.mjs';
import { planSandboxReplays, reconcileSandboxReplays } from './sandbox-replay.mjs';
import { replayFailureSpec } from './replay-dispute.mjs';

const allowed = new Set(['cb9848e341b42a45440fe96002acf94d50bf205996a0abec786574d942a2d60d']);
const base = 'https://api-m.sandbox.paypal.com';
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


const batchId = '40f79126-1d0a-4152-b23d-5ef9c221e7ce';
const digest = value => createHash('sha256').update(value).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value) && !/^MOCK-/i.test(value);

async function append(path, value) {
  const file = await open(path, 'a', 0o600);
  try { await file.writeFile(`${JSON.stringify(value)}\n`); await file.sync(); }
  finally { await file.close(); }
}

async function run(claimId) {
  if (!allowed.has(claimId)) throw new Error('This claim is not the verified 503 recovery.');
  const claimPath = join('.data', 'bulk-replay-claims', `${claimId}.json`);
  const recoveryPath = join('.data', 'order-503-recovery', `${claimId}.jsonl`);
  const claimText = await readFile(claimPath, 'utf8');
  const claim = claimText.split('\n').filter(Boolean).map(JSON.parse);
  const recoveryText = await readFile(recoveryPath, 'utf8');
  const recovery = recoveryText.split('\n').filter(Boolean).map(JSON.parse);
  if (claim.length !== 3 || claim[0].state !== 'reserved' || claim[1].state !== 'order-requested' || claim[2].state !== 'capture-unverified' || claim[2].http !== 503 || digest(claim[0].key) !== claimId || recovery.length !== 2 || recovery[0].state !== 'recovery-requested' || recovery[0].claimId !== claimId || recovery[0].key !== claim[0].key || recovery[0].requestId !== claim[1].requestId || recovery[1].state !== 'capture-verified' || recovery[1].funding !== 'paypal-sandbox-test-card' || !id(recovery[1].captureId) || recovery[1].amount?.value !== claim[1].amount || recovery[1].amount?.currency_code !== claim[1].currency || recovery[1].captureStatus !== 'COMPLETED') throw new Error('The claim or recovered capture is not fully verified.');
  const batch = JSON.parse(await readFile(new URL(`../.data/batches/${batchId}.json`, import.meta.url), 'utf8'));
  const plan = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses: 10 });
  const item = plan.queue.find(entry => entry.key === claim[0].key);
  const spec = replayFailureSpec(item);
  if (!item || item.status !== 'fail' || spec.reason || !spec.disputeRequired || spec.captureAmount !== claim[1].amount || spec.currency !== claim[1].currency) throw new Error('The recovered capture does not match a supported original failure.');
  const adapter = createPayPalSandbox(await loadSandboxCredentials());
  const capture = await adapter.getCapture(recovery[1].captureId);
  if (!capture.ok || capture.status !== 200 || capture.body?.id !== recovery[1].captureId || capture.body.status !== 'COMPLETED' || capture.body.amount?.value !== claim[1].amount || capture.body.amount?.currency_code !== claim[1].currency) throw new Error('PayPal did not confirm a matching completed capture. No refund was attempted.');
  const directory = join('.data', 'order-503-continuation');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const journal = join(directory, `${claimId}.jsonl`);
  const file = await open(journal, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify({ state: 'continuation-requested', key: item.key, captureId: recovery[1].captureId, at: new Date().toISOString() })}\n`); await file.sync(); }
  finally { await file.close(); }
  if (await readFile(claimPath, 'utf8') !== claimText || await readFile(recoveryPath, 'utf8') !== recoveryText) throw new Error('A journal changed. No refund was attempted.');
  const credentials = await loadSandboxCredentials();
  let dispute;
  try { dispute = await createSandboxChargeback(await tokenFor(credentials), adapter, recovery[1].captureId, claim[1].amount, claim[1].currency); } catch { await append(journal, { state: 'chargeback-unknown' }); throw new Error('Chargeback outcome unknown. Do not repeat automatically.'); }
  await append(journal, { state: dispute.ok ? 'chargeback-confirmed' : 'chargeback-unverified', ...dispute });
  if (!dispute.ok) throw new Error('PayPal did not confirm a uniquely linked open chargeback. No refund was attempted.');
  const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
  const sessionId = randomUUID();
  let receipt;
  try { receipt = await ledger.execute({ item, sessionId, adapter, approval: { sessionId, captureId: recovery[1].captureId, funding: 'paypal-sandbox-test-card', disputeId: dispute.disputeId, disputeKind: 'sandbox-card-chargeback' } }); }
  catch { await append(journal, { state: 'outcome-unknown' }); throw new Error('Outcome unknown. Do not retry automatically.'); }
  const result = reconcileSandboxReplays({ plan: { ...plan, queue: [item] }, evidence: [receipt], verifyReceipt: ledger.verifyReceipt }).results[0];
  await append(journal, { state: 'finished', source: receipt.source, status: receipt.status, reason: receipt.reason, comparison: result.status });
  return { key: item.key, captureId: recovery[1].captureId, receipt, comparison: result, limitation: 'Sandbox-only. Complete external refund history and exclusive account access are not established.' };
}

try { console.log(JSON.stringify(await run(process.argv[2]))); }
catch (error) { console.error(error.message); process.exitCode = 1; }
