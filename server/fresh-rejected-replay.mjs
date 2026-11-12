import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createReplayLedger } from './replay-ledger.mjs';
import { planSandboxReplays } from './sandbox-replay.mjs';
import { replayFailureSpec } from './replay-dispute.mjs';
import { authenticateReplaySandbox, replaySandboxCredentials, runSandboxReplayBatch } from './batch-replay-runner.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hash = value => createHash('sha256').update(value).digest('hex');

async function main() {
  const [batchId, personaId, trialText] = process.argv.slice(2);
  const trial = Number(trialText);
  if (!uuid.test(batchId || '') || !/^persona-[a-f0-9]{20}$/.test(personaId || '') || !Number.isSafeInteger(trial) || trial < 1) throw new Error('Usage: node server/fresh-rejected-replay.mjs BATCH-ID PERSONA-ID TRIAL');
  const batch = JSON.parse(await readFile(`.data/batches/${batchId}.json`, 'utf8'));
  const item = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses: 0 }).queue.find(entry => entry.personaId === personaId && entry.trial === trial);
  if (!item || item.status !== 'fail') throw new Error('The original failed trial is required.');
  const spec = replayFailureSpec(item);
  if (spec.reason || spec.disputeRequired || spec.steps?.length !== 2 || spec.steps[0].decision === spec.steps[1].decision) throw new Error('Only two distinct, non-dispute refund decisions can be replayed.');
  const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
  const receipt = (await ledger.evidence()).find(entry => entry.key === item.key);
  const first = receipt?.attempts?.[0]?.refund;
  if (!receipt || !ledger.verifyReceipt(receipt, item) || receipt.source !== 'paypal-sandbox' || receipt.simulated !== false || receipt.attempts?.length !== 1 || first?.ok !== false || first.status !== 422 || !first.body?.details?.some(detail => ['REFUND_NOT_ALLOWED', 'REFUND_FAILED_INSUFFICIENT_FUNDS'].includes(detail.issue))) throw new Error('An authenticated one-call sandbox receipt with a definitive supported 422 rejection is required.');
  const credentials = await replaySandboxCredentials();
  await authenticateReplaySandbox(credentials);
  const replacementId = randomUUID();
  const directory = '.data/fresh-rejected-replays';
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let reservation;
  try { reservation = await open(join(directory, `${hash(item.key)}.jsonl`), 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('A fresh replay has already been reserved. Do not repeat it automatically.'); throw error; }
  try { await reservation.writeFile(`${JSON.stringify({ state: 'reserved', originalKey: item.key, replacementBatchId: replacementId, observedFirstStatus: 422 })}\n`); await reservation.sync(); }
  finally { await reservation.close(); }
  const original = batch.results.find(result => result.personaId === personaId && result.trial === trial);
  const replacement = { ...batch, id: replacementId, createdAt: new Date().toISOString(), personaCount: 1, trials: 1, counts: { pass: 0, fail: 1, unverified: 0 }, results: [original], failureClusters: [], replacementOf: { batchId, personaId, trial, originalKeys: [item.key], accountContext: process.env.STILL_REPLAY_USE_ENV_CREDENTIALS === '1' ? 'isolated-process-sandbox-account' : 'connected-sandbox-account', meaning: 'Fresh sandbox attempt of a recorded failure. Original receipt and result are unchanged; a different merchant cannot establish the earlier outcome.' } };
  const file = await open(`.data/batches/${replacementId}.json`, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(replacement)); await file.sync(); } finally { await file.close(); }
  const outcome = await runSandboxReplayBatch({ batchId: replacementId, limit: 1, concurrency: 1, replayCredentials: credentials });
  const journal = await open(join(directory, `${hash(item.key)}.jsonl`), 'a', 0o600);
  try { await journal.writeFile(`${JSON.stringify({ state: 'runner-returned', outcome })}\n`); await journal.sync(); } finally { await journal.close(); }
  console.log(JSON.stringify({ originalKey: item.key, replacementBatchId: replacementId, originalResultChanged: false, source: 'paypal-sandbox', outcome }));
  if (outcome.stopped) process.exitCode = 1;
}

try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
