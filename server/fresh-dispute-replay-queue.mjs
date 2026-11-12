import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runSandboxReplayBatch } from './batch-replay-runner.mjs';
import { createReplayLedger } from './replay-ledger.mjs';
import { planSandboxReplays } from './sandbox-replay.mjs';
import { replayFailureSpec } from './replay-dispute.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = value => createHash('sha256').update(value).digest('hex');

async function main() {
  const [batchId, countText = '1', workersText = '1'] = process.argv.slice(2);
  const count = Number(countText), concurrency = Number(workersText);
  if (!uuid.test(batchId || '') || !Number.isSafeInteger(count) || count < 1 || count > 5000 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Usage: node server/fresh-dispute-replay-queue.mjs BATCH-ID COUNT(1..5000) WORKERS(1..8)');
  const source = JSON.parse(await readFile(`.data/batches/${batchId}.json`, 'utf8'));
  const plan = planSandboxReplays({ batchId, batch: source, maxRuns: source.results.length, samplePasses: 0 });
  const items = new Map(plan.queue.map(item => [item.key, item]));
  const sourceResults = new Map(source.results.map(result => [JSON.stringify([batchId, String(result.personaId), result.trial]), result]));
  const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
  const prior = new Set((await ledger.evidence()).map(receipt => receipt.key));
  const originalClaims = '.data/bulk-replay-claims';
  const replacementClaims = '.data/fresh-dispute-replay-batches';
  await mkdir(replacementClaims, { recursive: true, mode: 0o700 });
  const replacementBatchId = randomUUID(), selected = [];
  for (const name of (await readdir(originalClaims)).sort()) {
    if (selected.length >= count) break;
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    let lines;
    try { lines = (await readFile(join(originalClaims, name), 'utf8')).trim().split('\n').map(JSON.parse); } catch { continue; }
    const key = lines[0]?.key, item = items.get(key), captured = lines.find(line => line.state === 'captured');
    if (!item || digest(key) !== name.slice(0, 64) || prior.has(key) || item.status !== 'fail' || lines.at(-1)?.state !== 'chargeback-unverified' || lines.at(-1)?.http !== 201 || captured?.ok !== true) continue;
    const spec = replayFailureSpec(item);
    if (spec.reason || !spec.disputeRequired || !sourceResults.has(key)) continue;
    let reservation;
    try { reservation = await open(join(replacementClaims, `${digest(key)}.json`), 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    try { await reservation.writeFile(JSON.stringify({ originalKey: key, replacementBatchId, createdAt: new Date().toISOString(), status: 'reserved' })); await reservation.sync(); } finally { await reservation.close(); }
    selected.push({ key, item, result: sourceResults.get(key) });
  }
  if (!selected.length) { console.log(JSON.stringify({ sourceBatchId: batchId, selected: 0, note: 'No unreserved deferred dispute trials were eligible.' })); return; }
  const replacement = { ...source, id: replacementBatchId, createdAt: new Date().toISOString(), personaCount: new Set(selected.map(entry => entry.item.personaId)).size, counts: { pass: 0, fail: selected.length, unverified: 0 }, results: selected.map(entry => entry.result), failureClusters: [], replacementOf: { batchId, originalKeys: selected.map(entry => entry.key), meaning: 'Fresh sandbox attempts of the same saved mock traces. Original claims and results are unchanged.' } };
  const batchFile = await open(`.data/batches/${replacementBatchId}.json`, 'wx', 0o600);
  try { await batchFile.writeFile(JSON.stringify(replacement)); await batchFile.sync(); } finally { await batchFile.close(); }
  console.log(JSON.stringify({ sourceBatchId: batchId, replacementBatchId, selected: selected.length, source: 'paypal-sandbox', funding: 'paypal-sandbox-test-card', originalResultsChanged: false }));
  const outcome = await runSandboxReplayBatch({ batchId: replacementBatchId, limit: selected.length, concurrency, onProgress: value => { if (value.attempted % 10 === 0) console.log(JSON.stringify(value)); } });
  console.log(JSON.stringify({ replacementBatchId, outcome }));
}

try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
