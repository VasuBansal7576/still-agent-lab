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
  const previousPath = join('.data', 'order-503-continuation', `${claimId}.jsonl`);
  const previousText = await readFile(previousPath, 'utf8');
  const previous = previousText.split('\n').filter(Boolean).map(JSON.parse);
  if (previous.length !== 2 || previous[0].state !== 'continuation-requested' || previous[0].captureId !== recovery[1].captureId || previous[1].state !== 'chargeback-unverified' || previous[1].http !== 201) throw new Error('An accepted unresolved chargeback request is required.');
  const directory = join('.data', 'order-503-resume');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const journal = join(directory, `${claimId}.jsonl`);
  const file = await open(journal, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify({ state: 'continuation-requested', key: item.key, captureId: recovery[1].captureId, at: new Date().toISOString() })}\n`); await file.sync(); }
  finally { await file.close(); }
  if (await readFile(claimPath, 'utf8') !== claimText || await readFile(recoveryPath, 'utf8') !== recoveryText || await readFile(previousPath, 'utf8') !== previousText) throw new Error('A journal changed. No refund was attempted.');
  const token = await tokenFor(await loadSandboxCredentials());
  const query = new URLSearchParams({ disputed_transaction_id: recovery[1].captureId, page_size: '50' });
  const response = await fetch(`${base}/v1/customer/disputes?${query}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  const body = await response.json().catch(() => ({}));
  const ids = Array.isArray(body.items) ? body.items.map(item => item.dispute_id).filter(id) : [];
  if (!response.ok || ids.length !== 1 || body.links?.some(link => link.rel === 'next')) throw new Error('A unique chargeback has not been confirmed. No refund was attempted.');
  const detail = await adapter.getAccountDispute(ids[0]);
  if (!detail.ok || !['OPEN', 'UNDER_REVIEW', 'WAITING_FOR_SELLER_RESPONSE', 'WAITING_FOR_BUYER_RESPONSE'].includes(detail.body?.status) || detail.body?.sellerTransactionIds?.length !== 1 || detail.body.sellerTransactionIds[0] !== recovery[1].captureId) throw new Error('PayPal did not confirm an unresolved chargeback linked to this capture.');
  const dispute = { disputeId: ids[0] };
  await append(journal, { state: 'chargeback-confirmed', disputeId: ids[0], status: detail.body.status, captureId: recovery[1].captureId, scenario: 'sandbox-card-chargeback-not-wallet-inquiry' });
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
