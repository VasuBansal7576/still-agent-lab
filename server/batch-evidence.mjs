import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { planSandboxReplays, reconcileSandboxReplays } from './sandbox-replay.mjs';

// Read only the immediate receipts for this batch; no provider or continuation calls.
export async function batchSandboxCoverage({ batch, batchId, ledgerDirectory }) {
  const plan = planSandboxReplays({ batchId, batch, maxRuns: 0, samplePasses: 10 });
  const receiptDirectory = join(ledgerDirectory, 'receipts');
  let names;
  try { names = new Set(await readdir(receiptDirectory)); }
  catch (error) { if (error.code === 'ENOENT') names = new Set(); else throw error; }
  const evidence = [], saved = new Map();
  for (const item of plan.queue) {
    const name = `${createHash('sha256').update(item.key).digest('hex')}.json`;
    if (!names.has(name)) continue;
    try {
      const record = JSON.parse(await readFile(join(receiptDirectory, name), 'utf8'));
      if (record?.key !== item.key) continue;
      saved.set(item.key, JSON.stringify(record));
      evidence.push(record);
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  }
  const comparison = reconcileSandboxReplays({ plan, evidence, verifyReceipt: (receipt, item) => item.key === receipt.key && saved.get(item.key) === JSON.stringify(receipt) });
  const clusterReplays = (batch.failureClusters || []).map(cluster => ({ clusterId: cluster.id, result: comparison.results.find(result => result.personaId === cluster.example?.personaId && result.trial === cluster.example?.trial) || { status: 'unverified', reason: 'This example is not in the replay queue.' } }));
  return { batchId, queueCount: plan.queueCount, failureCount: plan.failureCount, sampledPassCount: plan.sampledPassCount, excludedUnverifiedCount: plan.excludedUnverifiedCount, compared: comparison.compared, agreed: comparison.agreed, disagreed: comparison.disagreed, unverified: plan.queueCount - comparison.compared, agreement: comparison.agreement, clusterReplays };
}
