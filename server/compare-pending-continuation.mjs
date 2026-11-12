import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReplayLedger } from './replay-ledger.mjs';
import { planSandboxReplays } from './sandbox-replay.mjs';
import { replayFailureSpec } from './replay-dispute.mjs';
import { parseMoney } from './paypal-mock.mjs';

export async function pendingComparisonContext(batchId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(batchId || '')) throw new TypeError('A saved batch is required.');
  const batch = JSON.parse(await readFile(new URL(`../.data/batches/${batchId}.json`, import.meta.url), 'utf8'));
  const plan = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses: 10 });
  const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
  return { batchId, items: new Map(plan.queue.map(item => [item.key, item])), receipts: new Map((await ledger.evidence()).map(receipt => [receipt.key, receipt])), ledger };
}

export async function comparePendingContinuation({ batchId, personaId, trial, context } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(batchId || '') || !/^persona-[a-f0-9]{20}$/.test(personaId || '') || !Number.isSafeInteger(trial) || trial < 1) throw new TypeError('A saved batch, persona and trial are required.');
  const prepared = context || await pendingComparisonContext(batchId);
  if (prepared.batchId !== batchId) throw new Error('The comparison context belongs to another batch.');
  const item = prepared.items.get(JSON.stringify([batchId, personaId, trial]));
  const spec = replayFailureSpec(item);
  if (!item || spec.reason || spec.disputeRequired || spec.steps?.length !== 2) throw new Error('A two-call non-dispute failure is required.');
  const ledger = prepared.ledger;
  const receipt = prepared.receipts.get(item.key);
  if (!receipt || !ledger.verifyReceipt(receipt, item) || receipt.source !== 'paypal-sandbox' || receipt.simulated !== false || receipt.attempts?.length !== 1) throw new Error('An authenticated one-attempt sandbox receipt is required.');
  const hash = createHash('sha256').update(item.key).digest('hex');
  const records = (await readFile(resolve('.data/pending-refund-continuations', `${hash}.jsonl`), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  if (records.length !== 2 || records[0].state !== 'reserved' || records[1].state !== 'observed' || records[0].key !== item.key || records[1].key !== item.key || records[1].source !== 'paypal-sandbox' || records[1].timing !== 'delayed-continuation' || JSON.stringify(records[0].request) !== JSON.stringify(records[1].request)) throw new Error('A complete one-use sandbox continuation journal is required.');
  const first = receipt.attempts[0], next = records[1], captureId = receipt.capture?.body?.id;
  if (!first?.refund?.ok || first.refund.status !== 201 || first.refund.body?.status !== 'PENDING' || !first.refund.body?.id || first.request?.captureId !== captureId || next.first?.id !== first.refund.body.id || next.first?.recordedStatus !== 'PENDING' || next.request?.captureId !== captureId || next.request?.currency !== spec.currency || next.request?.amount !== spec.steps[1].amount || !next.request?.requestId || !Number.isInteger(next.response?.status) || typeof next.response?.ok !== 'boolean') throw new Error('The provider calls do not match the recorded replay.');
  if (next.response.status >= 500 || [401, 403, 429].includes(next.response.status)) throw new Error('The delayed refund response is uncertain or unavailable.');
  if (next.response.ok && (![200, 201].includes(next.response.status) || !next.response.body?.id || !['PENDING', 'COMPLETED'].includes(next.response.body?.status) || parseMoney(next.response.body?.amount?.value) === null || !/^[A-Z]{3}$/.test(next.response.body?.amount?.currency_code || ''))) throw new Error('The delayed success response is incomplete.');
  if (!next.response.ok && (next.response.status < 400 || typeof next.response.body?.name !== 'string' || !Array.isArray(next.response.body?.details) || !next.response.body.details.some(detail => typeof detail?.issue === 'string' && detail.issue))) throw new Error('The delayed rejection response is incomplete.');
  const expectedSame = spec.steps[0].decision === spec.steps[1].decision;
  if (expectedSame !== (first.request.requestId === next.request.requestId)) throw new Error('The continuation request ID does not match the recorded decision identity.');
  const actual = [first.refund, next.response];
  const comparisons = spec.steps.map((step, index) => {
    const provider = actual[index], amount = provider.body?.amount;
    const match = (step.mock.status === null || step.mock.status === provider.status) && step.mock.outcome === provider.body?.status && parseMoney(step.mock.amount?.value) !== null && parseMoney(step.mock.amount.value) === parseMoney(amount?.value) && step.mock.amount.currency_code === amount?.currency_code;
    return { mock: step.mock, provider: { http: provider.status, ok: provider.ok, id: provider.body?.id || null, status: provider.body?.status || null, amount: amount || null, name: provider.body?.name || null }, match };
  });
  if (first.refund.body.id && next.response.body?.id) comparisons[1].sameRefundIdentityMatches = (spec.steps[0].mock.id === spec.steps[1].mock.id) === (first.refund.body.id === next.response.body.id);
  const same = comparisons[1].sameRefundIdentityMatches;
  return { key: item.key, source: 'paypal-sandbox', status: comparisons.every(entry => entry.match) && same !== false ? 'agreed' : 'disagreed', timing: 'delayed-continuation', comparisons, limitation: 'The second call occurred later than the recorded mock. Pending refunds are not completed. This separate report does not replace the immutable original receipt or enter the aggregate agreement score.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await comparePendingContinuation({ batchId: process.argv[2], personaId: process.argv[3], trial: Number(process.argv[4]) }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
