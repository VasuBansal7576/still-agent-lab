import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createReplayLedger } from './replay-ledger.mjs';
import { planSandboxReplays } from './sandbox-replay.mjs';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';
import { createPayPalSandbox } from './paypal.mjs';

const batchId = '40f79126-1d0a-4152-b23d-5ef9c221e7ce';
const delayedKey = JSON.stringify([batchId, 'persona-03c92203884e41321d7f', 3]);
const ids = new Set(['2TJ9483304451523J', '77V75765L2479350P', '7P490480N5737100C', '3W346493CH184302A', '32F56517PR2695601']);

export async function observeUncertainRefunds() {
  const batch = JSON.parse(await readFile(new URL(`../.data/batches/${batchId}.json`, import.meta.url), 'utf8'));
  const plan = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses: 10 });
  const items = new Map(plan.queue.map(item => [item.key, item]));
  const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
  const receipts = (await ledger.evidence()).filter(receipt => ids.has(receipt.capture?.body?.id));
  const paypal = createPayPalSandbox(await loadSandboxCredentials());
  const results = [];
  for (const receipt of receipts) {
    const item = items.get(receipt.key), captureId = receipt.capture?.body?.id;
    if (!item || !ledger.verifyReceipt(receipt, item) || receipt.source !== 'paypal-sandbox' || receipt.simulated !== false) continue;
    let attempt;
    if (receipt.key === delayedKey) {
      const hash = createHash('sha256').update(receipt.key).digest('hex');
      const journal = (await readFile(resolve('.data/pending-refund-continuations', `${hash}.jsonl`), 'utf8')).trim().split('\n').map(JSON.parse);
      if (journal.length !== 2 || journal[0]?.state !== 'reserved' || journal[1]?.state !== 'observed' || journal[0].key !== receipt.key || journal[1].key !== receipt.key || journal[1].source !== 'paypal-sandbox' || JSON.stringify(journal[0].request) !== JSON.stringify(journal[1].request) || journal[1].request?.captureId !== captureId || journal[1].response?.status !== 503 || receipt.attempts?.[0]?.refund?.body?.id !== journal[1].first?.id) continue;
      attempt = journal[1];
    } else {
      attempt = receipt.attempts?.find(entry => entry.request?.captureId === captureId && entry.refund?.status === 503);
    }
    if (!attempt) continue;
    let capture;
    try { capture = await paypal.getCapture(captureId); } catch { capture = { status: null, body: {} }; }
    const body = capture.body || {};
    const captureMatches = capture.status === 200 && body.id === captureId && body.amount?.value === receipt.capture.body.amount?.value && body.amount?.currency_code === receipt.capture.body.amount?.currency_code;
    results.push({ captureId, timing: receipt.key === delayedKey ? 'delayed-continuation' : 'immediate-replay', originalRefundHttp: 503, captureHttp: capture.status, captureStatus: body.status || null, captureAmount: body.amount || null, captureMatches, uncertainRefundOutcome: 'unverified' });
  }
  return { source: 'paypal-sandbox', observedAt: new Date().toISOString(), checked: results.length, results, note: 'Read-only capture observations cannot establish whether the 503 refund executed. No refund was sent or retried.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await observeUncertainRefunds(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
