import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';
import { createPayPalSandbox } from './paypal.mjs';
import { createReplayLedger } from './replay-ledger.mjs';
import { planSandboxReplays, reconcileSandboxReplays } from './sandbox-replay.mjs';
import { replayFailureSpec } from './replay-dispute.mjs';

const batchId = '40f79126-1d0a-4152-b23d-5ef9c221e7ce';
const digest = value => createHash('sha256').update(value).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value) && !/^MOCK-/i.test(value);

async function append(path, value) {
  const file = await open(path, 'a', 0o600);
  try { await file.writeFile(`${JSON.stringify(value)}\n`); await file.sync(); }
  finally { await file.close(); }
}

async function run(claimId) {
  if (claimId !== 'e50885469d24eb42fe01a9dec1f4e09d1aca78ed2061fae2016d7384d2d6eb05') throw new Error('Supply one verified provider-error claim ID.');
  const claimPath = join('.data', 'bulk-replay-claims', `${claimId}.json`);
  const recoveryPath = join('.data', 'order-unknown-recovery', `${claimId}.jsonl`);
  const claimText = await readFile(claimPath, 'utf8');
  const claim = claimText.split('\n').filter(Boolean).map(JSON.parse);
  const recoveryText = await readFile(recoveryPath, 'utf8');
  const recovery = recoveryText.split('\n').filter(Boolean).map(JSON.parse);
  if (claim.length !== 3 || claim[0].state !== 'reserved' || claim[1].state !== 'order-requested' || claim[2].state !== 'order-unknown' || digest(claim[0].key) !== claimId || recovery.length !== 2 || recovery[0].state !== 'recovery-requested' || recovery[0].claimId !== claimId || recovery[0].key !== claim[0].key || recovery[0].requestId !== claim[1].requestId || recovery[1].state !== 'capture-verified' || recovery[1].funding !== 'paypal-sandbox-test-card' || !id(recovery[1].captureId) || recovery[1].amount?.value !== claim[1].amount || recovery[1].amount?.currency_code !== claim[1].currency || recovery[1].captureStatus !== 'COMPLETED') throw new Error('The claim or recovered capture is not fully verified.');
  const batch = JSON.parse(await readFile(new URL(`../.data/batches/${batchId}.json`, import.meta.url), 'utf8'));
  const plan = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses: 10 });
  const item = plan.queue.find(entry => entry.key === claim[0].key);
  const spec = replayFailureSpec(item);
  if (!item || item.status !== 'fail' || spec.reason || spec.disputeRequired || spec.captureAmount !== claim[1].amount || spec.currency !== claim[1].currency) throw new Error('The recovered capture does not match a supported original failure.');
  const adapter = createPayPalSandbox(await loadSandboxCredentials());
  const capture = await adapter.getCapture(recovery[1].captureId);
  if (!capture.ok || capture.status !== 200 || capture.body?.id !== recovery[1].captureId || capture.body.status !== 'COMPLETED' || capture.body.amount?.value !== claim[1].amount || capture.body.amount?.currency_code !== claim[1].currency) throw new Error('PayPal did not confirm a matching completed capture. No refund was attempted.');
  const directory = join('.data', 'order-unknown-continuation');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const journal = join(directory, `${claimId}.jsonl`);
  const file = await open(journal, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify({ state: 'continuation-requested', key: item.key, captureId: recovery[1].captureId, at: new Date().toISOString() })}\n`); await file.sync(); }
  finally { await file.close(); }
  if (await readFile(claimPath, 'utf8') !== claimText || await readFile(recoveryPath, 'utf8') !== recoveryText) throw new Error('A journal changed. No refund was attempted.');
  const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
  const sessionId = randomUUID();
  let receipt;
  try { receipt = await ledger.execute({ item, sessionId, adapter, approval: { sessionId, captureId: recovery[1].captureId, funding: 'paypal-sandbox-test-card' } }); }
  catch { await append(journal, { state: 'outcome-unknown' }); throw new Error('Outcome unknown. Do not retry automatically.'); }
  const result = reconcileSandboxReplays({ plan: { ...plan, queue: [item] }, evidence: [receipt], verifyReceipt: ledger.verifyReceipt }).results[0];
  await append(journal, { state: 'finished', source: receipt.source, status: receipt.status, reason: receipt.reason, comparison: result.status });
  return { key: item.key, captureId: recovery[1].captureId, receipt, comparison: result, limitation: 'Sandbox-only. Complete external refund history and exclusive account access are not established.' };
}

try { console.log(JSON.stringify(await run(process.argv[2]))); }
catch (error) { console.error(error.message); process.exitCode = 1; }
