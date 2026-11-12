import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runSandboxReplayBatch } from './batch-replay-runner.mjs';
import { createReplayLedger } from './replay-ledger.mjs';
import { planSandboxReplays } from './sandbox-replay.mjs';
import { replayFailureSpec } from './replay-dispute.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = value => createHash('sha256').update(value).digest('hex');

async function main() {
  const [batchId, personaId, trialText] = process.argv.slice(2);
  const trial = Number(trialText);
  if (!uuid.test(batchId || '') || !/^persona-[a-z0-9-]{1,100}$/.test(personaId || '') || !Number.isSafeInteger(trial) || trial < 1) throw new Error('Usage: node server/fresh-dispute-replay-batch.mjs BATCH-ID PERSONA-ID TRIAL');
  const source = JSON.parse(await readFile(`.data/batches/${batchId}.json`, 'utf8'));
  const plan = planSandboxReplays({ batchId, batch: source, maxRuns: source.results.length, samplePasses: 0 });
  const key = JSON.stringify([batchId, personaId, trial]);
  const item = plan.queue.find(entry => entry.key === key);
  if (!item || item.status !== 'fail' || !replayFailureSpec(item).disputeRequired || replayFailureSpec(item).reason) throw new Error('The original failure is not a supported dispute scenario.');
  const claimFile = `.data/bulk-replay-claims/${digest(key)}.json`;
  const lines = (await readFile(claimFile, 'utf8')).trim().split('\n').map(JSON.parse);
  if (lines[0]?.key !== key || lines.at(-1)?.state !== 'chargeback-unverified' || !lines.some(line => line.state === 'captured' && line.ok === true)) throw new Error('The original claim is not a deferred captured chargeback.');
  const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
  if ((await ledger.evidence()).some(receipt => receipt.key === key)) throw new Error('The original trial already has a replay receipt.');

  const replacementBatchId = randomUUID();
  const directory = '.data/fresh-dispute-replay-batches';
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let reservation;
  try { reservation = await open(join(directory, `${digest(key)}.json`), 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('A replacement has already been reserved for this original trial. Do not repeat it.'); throw error; }
  try {
    await reservation.writeFile(JSON.stringify({ originalKey: key, replacementBatchId, createdAt: new Date().toISOString(), status: 'reserved' }));
    await reservation.sync();
  } finally { await reservation.close(); }

  const result = source.results.find(entry => entry.personaId === personaId && entry.trial === trial);
  const replacement = { ...source, id: replacementBatchId, createdAt: new Date().toISOString(), personaCount: 1, trials: 1, counts: { pass: 0, fail: 1, unverified: 0 }, results: [result], failureClusters: [], replacementOf: { batchId, personaId, trial, meaning: 'Fresh sandbox attempt of the same saved mock trace. The original receipt and result are unchanged.' } };
  const batchFile = await open(`.data/batches/${replacementBatchId}.json`, 'wx', 0o600);
  try { await batchFile.writeFile(JSON.stringify(replacement)); await batchFile.sync(); } finally { await batchFile.close(); }
  const outcome = await runSandboxReplayBatch({ batchId: replacementBatchId, limit: 1, concurrency: 1 });
  const journal = await open(join(directory, `${digest(key)}.json`), 'a', 0o600);
  try { await journal.writeFile(`\n${JSON.stringify({ status: 'runner-returned', outcome })}`); await journal.sync(); } finally { await journal.close(); }
  console.log(JSON.stringify({ originalKey: key, replacementBatchId, source: 'paypal-sandbox', originalResultChanged: false, outcome }));
}

try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
