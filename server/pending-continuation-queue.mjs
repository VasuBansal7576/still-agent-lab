import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReplayLedger } from './replay-ledger.mjs';
import { planSandboxReplays } from './sandbox-replay.mjs';
import { replayFailureSpec } from './replay-dispute.mjs';
import { continuePendingRefund } from './continue-pending-refund.mjs';
import { comparePendingContinuation } from './compare-pending-continuation.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = value => createHash('sha256').update(value).digest('hex');

export async function runPendingContinuationQueue({ batchId, limit = 10, onProgress = () => {} } = {}) {
  if (!uuid.test(batchId || '') || !Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new TypeError('Provide a batch ID and a limit from 1 to 5000.');
  const batch = JSON.parse(await readFile(new URL(`../.data/batches/${batchId}.json`, import.meta.url), 'utf8'));
  const plan = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses: 10 });
  const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
  const receipts = new Map((await ledger.evidence()).map(receipt => [receipt.key, receipt]));
  const summary = { batchId, provenance: 'paypal-sandbox', timing: 'delayed-continuation', eligible: 0, alreadyClaimed: 0, attempted: 0, agreed: 0, disagreed: 0, unverified: 0, stopped: false };
  for (const item of plan.queue) {
    const spec = replayFailureSpec(item), receipt = receipts.get(item.key), first = receipt?.attempts?.[0];
    if (item.status !== 'fail' || spec.reason || spec.disputeRequired || spec.steps?.length !== 2 || receipt?.source !== 'paypal-sandbox' || receipt.simulated !== false || receipt.attempts?.length !== 1 || !first?.refund?.ok || first.refund.status !== 201 || first.refund.body?.status !== 'PENDING' || !ledger.verifyReceipt(receipt, item)) continue;
    summary.eligible++;
    try { await access(resolve('.data/pending-refund-continuations', `${digest(item.key)}.jsonl`)); summary.alreadyClaimed++; continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (summary.attempted >= limit) continue;
    summary.attempted++;
    try {
      const response = await continuePendingRefund({ batchId, personaId: item.personaId, trial: item.trial });
      if (response.state !== 'observed' || !response.response || [401, 403, 429].includes(response.response.status) || response.response.status >= 500) { summary.unverified++; summary.stopped = true; onProgress({ ...summary, key: item.key, reason: 'Provider outcome is uncertain or unavailable.' }); break; }
      const comparison = await comparePendingContinuation({ batchId, personaId: item.personaId, trial: item.trial });
      if (comparison.status === 'agreed') summary.agreed++; else if (comparison.status === 'disagreed') summary.disagreed++; else summary.unverified++;
      onProgress({ ...summary, key: item.key, comparison: comparison.status });
    } catch (error) {
      summary.unverified++; summary.stopped = true;
      onProgress({ ...summary, key: item.key, reason: error.message });
      break;
    }
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await runPendingContinuationQueue({ batchId: process.argv[2], limit: Number(process.argv[3] || '10'), onProgress: result => console.log(JSON.stringify(result)) }); console.log(JSON.stringify(result)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
