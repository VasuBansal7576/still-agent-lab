import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';
import { createPayPalSandbox } from './paypal.mjs';
import { planSandboxReplays } from './sandbox-replay.mjs';
import { replayFailureSpec, verifyReplayDispute } from './replay-dispute.mjs';

const batchId = '40f79126-1d0a-4152-b23d-5ef9c221e7ce';
const digest = value => createHash('sha256').update(value).digest('hex');
async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function syncDir(path) { const directory = await open(path, 'r'); try { await directory.sync(); } finally { await directory.close(); } }

async function run(claimId, disputeId) {
  if (!/^[a-f0-9]{64}$/.test(claimId || '') || !/^[A-Za-z0-9_-]{1,127}$/.test(disputeId || '')) throw new Error('Supply a claim ID and a verified sandbox dispute ID.');
  const path = join('.data/bulk-replay-claims', `${claimId}.json`);
  const raw = await readFile(path, 'utf8');
  const lines = raw.trim().split('\n').map(JSON.parse);
  const key = lines[0]?.key, captured = lines.find(line => line.state === 'captured'), last = lines.at(-1);
  if (typeof key !== 'string' || digest(key) !== claimId || last?.state !== 'chargeback-unverified' || last.http !== 201 || captured?.captureStatus !== 'COMPLETED' || !captured?.ok || !captured.captureId) throw new Error('Claim does not establish an initially completed capture and pre-refund stop.');
  const batch = JSON.parse(await readFile(`.data/batches/${batchId}.json`, 'utf8'));
  const item = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses: 10 }).queue.find(entry => entry.key === key);
  const spec = replayFailureSpec(item);
  if (spec.reason || !spec.disputeRequired || spec.steps.length !== 1 || captured.amount?.value !== spec.captureAmount || captured.amount?.currency_code !== spec.currency) throw new Error('The original trial is not a supported single-refund dispute case.');
  const keys = '.data/replay-ledger/keys', captures = '.data/replay-ledger/captures', receipts = '.data/replay-ledger/receipts';
  if (await exists(join(keys, digest(key))) || await exists(join(captures, digest(captured.captureId))) || await exists(join(receipts, `${digest(key)}.json`)) || await exists(`${path}.resume`)) throw new Error('A prior reservation exists; do not repeat.');
  const adapter = createPayPalSandbox(await loadSandboxCredentials());
  const current = await adapter.getCapture(captured.captureId);
  if (!current.ok || current.status !== 200 || current.body?.id !== captured.captureId || current.body?.status !== 'PENDING' || current.body.amount?.value !== spec.captureAmount || current.body.amount?.currency_code !== spec.currency) throw new Error('Current capture is not the matching pending sandbox capture.');
  const dispute = await verifyReplayDispute({ adapter, disputeId, checkout: { state: 'captured', captureId: captured.captureId, buyerApprovalConfirmed: true, replayKey: key } });
  if (!dispute.verified) throw new Error('PayPal did not verify the linked unresolved sandbox dispute.');
  await mkdir('.data/changed-state-probes', { recursive: true, mode: 0o700 });
  await mkdir(`${path}.resume`, { mode: 0o700 });
  await mkdir(join(keys, digest(key)), { mode: 0o700 });
  await mkdir(join(captures, digest(captured.captureId)), { mode: 0o700 });
  await syncDir('.data/bulk-replay-claims');
  await syncDir(keys);
  await syncDir(captures);
  if (await readFile(path, 'utf8') !== raw) throw new Error('The claim changed; no refund attempted.');
  const journal = await open(`.data/changed-state-probes/${claimId}.jsonl`, 'wx', 0o600);
  const requestId = randomUUID();
  try {
    await journal.writeFile(`${JSON.stringify({ state: 'requested', key, captureId: captured.captureId, disputeId, requestId, at: new Date().toISOString() })}\n`);
    await journal.sync();
    await syncDir('.data/changed-state-probes');
    let result;
    try { result = spec.steps[0].amount === undefined ? await adapter.refundCaptureWithoutAmount(captured.captureId, { requestId }) : await adapter.refundCapture(captured.captureId, { amount: spec.steps[0].amount, currency: spec.currency, requestId }); }
    catch { await journal.writeFile(`${JSON.stringify({ state: 'outcome-unknown' })}\n`); await journal.sync(); throw new Error('PayPal outcome unknown; do not repeat.'); }
    const record = { state: 'observed', source: 'paypal-sandbox', timing: 'changed-capture-state', claimId, captureId: captured.captureId, disputeId, priorCaptureStatus: captured.captureStatus, currentCapture: current, dispute, originalMock: spec.steps[0].mock, request: { amount: spec.steps[0].amount ?? null, currency: spec.currency }, response: result, limitation: 'A pending capture differs from the completed mock capture. This observation does not replace the original unverified replay or establish complete external refund history.' };
    await journal.writeFile(`${JSON.stringify(record)}\n`); await journal.sync();
    return record;
  } finally { await journal.close(); }
}

try { console.log(JSON.stringify(await run(process.argv[2], process.argv[3]))); }
catch (error) { console.error(error.message); process.exitCode = 1; }
