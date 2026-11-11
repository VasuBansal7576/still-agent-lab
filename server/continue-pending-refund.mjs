import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReplayLedger } from './replay-ledger.mjs';
import { planSandboxReplays } from './sandbox-replay.mjs';
import { replayFailureSpec } from './replay-dispute.mjs';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';
import { createPayPalSandbox } from './paypal.mjs';
import { parseMoney } from './paypal-mock.mjs';

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const syncDir = async path => { const dir = await open(path, 'r'); try { await dir.sync(); } finally { await dir.close(); } };

export async function continuePendingRefund({ batchId, personaId, trial } = {}) {
  if (!idPattern.test(batchId || '') || !/^persona-[a-f0-9]{20}$/.test(personaId || '') || !Number.isSafeInteger(trial) || trial < 1) throw new TypeError('A saved batch, persona and trial are required.');
  const batch = JSON.parse(await readFile(new URL(`../.data/batches/${batchId}.json`, import.meta.url), 'utf8'));
  const plan = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses: 10 });
  const item = plan.queue.find(entry => entry.personaId === personaId && entry.trial === trial);
  const spec = replayFailureSpec(item);
  if (spec.reason || spec.disputeRequired || spec.steps?.length !== 2) throw new Error('Only an explicit two-call non-dispute failure can be continued.');
  const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
  const receipt = (await ledger.evidence()).find(entry => entry.key === item.key);
  if (!receipt || !ledger.verifyReceipt(receipt, item) || receipt.source !== 'paypal-sandbox' || receipt.simulated !== false || receipt.attempts?.length !== 1) throw new Error('An authenticated one-attempt sandbox receipt is required.');
  const first = receipt.attempts[0];
  const captureId = receipt.capture?.body?.id;
  const firstId = first?.refund?.body?.id;
  const firstAmount = spec.steps[0].amount ?? spec.steps[0].mock.amount?.value;
  if (!first.refund?.ok || first.refund.status !== 201 || first.refund.body?.status !== 'PENDING' || !/^[A-Za-z0-9_-]{1,127}$/.test(firstId || '') || !/^[A-Za-z0-9_-]{1,127}$/.test(captureId || '') || first.request?.captureId !== captureId || !first.request?.requestId || parseMoney(first.refund.body.amount?.value) !== parseMoney(firstAmount) || first.refund.body.amount?.currency_code !== spec.currency) throw new Error('The first provider response must definitively confirm a pending refund matching the first mock call.');
  const paypal = createPayPalSandbox(await loadSandboxCredentials());
  const [capture, original] = await Promise.all([paypal.getCapture(captureId), paypal.getRefund(firstId)]);
  if (!capture.ok || capture.status !== 200 || capture.body?.id !== captureId || parseMoney(capture.body?.amount?.value) !== parseMoney(spec.captureAmount) || capture.body.amount?.currency_code !== spec.currency || !original.ok || original.status !== 200 || original.body?.id !== firstId || !['PENDING','COMPLETED'].includes(original.body.status) || parseMoney(original.body?.amount?.value) !== parseMoney(firstAmount) || original.body.amount?.currency_code !== spec.currency) throw new Error('PayPal did not confirm the original capture and refund.');
  const next = spec.steps[1];
  const requestId = next.decision === spec.steps[0].decision ? first.request.requestId : `still-${digest(JSON.stringify([item.key,captureId,next.decision,'pending-continuation'])).slice(0,40)}`;
  const dir = resolve('.data/pending-refund-continuations');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${digest(item.key)}.jsonl`);
  let journal;
  try { journal = await open(file, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') throw new Error('This continuation was already claimed. Do not retry an uncertain outcome.'); throw error; }
  const request = { captureId, amount: next.amount, currency: next.currency, requestId };
  try {
    await journal.writeFile(`${JSON.stringify({ state: 'reserved', key: item.key, firstRefundId: firstId, request, firstObserved: original.body.status, note: 'Delayed continuation; timing differs from the original mock. No unknown provider response was retried.' })}\n`);
    await journal.sync(); await syncDir(dir);
    let response;
    try { response = next.amount === undefined ? await paypal.refundCaptureWithoutAmount(captureId, { requestId }) : await paypal.refundCapture(captureId, { amount: next.amount, currency: next.currency, requestId }); }
    catch { await journal.writeFile(`${JSON.stringify({ state: 'uncertain', reason: 'Provider outcome unknown. Do not retry automatically.' })}\n`); await journal.sync(); return { state: 'uncertain', key: item.key }; }
    const result = { state: 'observed', key: item.key, source: 'paypal-sandbox', timing: 'delayed-continuation', first: { id: firstId, recordedStatus: 'PENDING', latestStatus: original.body.status }, request, response, limitation: 'This is a delayed second scripted call. It does not establish a continuous or immediate replay, exclusive access, or complete refund history.' };
    await journal.writeFile(`${JSON.stringify(result)}\n`); await journal.sync();
    return result;
  } finally { await journal.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await continuePendingRefund({ batchId: process.argv[2], personaId: process.argv[3], trial: Number(process.argv[4]) }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
