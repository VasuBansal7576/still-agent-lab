import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';
import { createPayPalSandbox } from './paypal.mjs';
import { createReplayLedger } from './replay-ledger.mjs';
import { planSandboxReplays, reconcileSandboxReplays } from './sandbox-replay.mjs';
import { replayFailureSpec, verifyReplayDispute } from './replay-dispute.mjs';

const batchId = '40f79126-1d0a-4152-b23d-5ef9c221e7ce';
const hash = value => createHash('sha256').update(value).digest('hex');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value) && !/^MOCK-/i.test(value);
async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function append(path, value) { const f = await open(path, 'a', 0o600); try { await f.writeFile(`${JSON.stringify(value)}\n`); await f.sync(); } finally { await f.close(); } }

async function run(claimId, execute) {
  if (!/^[a-f0-9]{64}$/.test(claimId || '')) throw new Error('Supply one claim ID.');
  const claimPath = join('.data', 'bulk-replay-claims', `${claimId}.json`);
  const raw = await readFile(claimPath, 'utf8');
  const lines = raw.trim().split('\n').map(JSON.parse);
  const key = lines[0]?.key, last = lines.at(-1), prior = lines.at(-2);
  const captured = lines.find(entry => entry.state === 'captured');
  if (typeof key !== 'string' || hash(key) !== claimId || last?.state !== 'executed' || last.source !== 'unverified-executor' || last.reason !== 'The sandbox capture does not match the mock capture.' || !captured?.ok || captured.captureStatus !== 'COMPLETED' || !validId(captured.captureId) || !['resume-requested', 'chargeback-confirmed'].includes(prior?.state) || prior.captureId !== captured.captureId || !validId(prior.disputeId) || prior.scenario !== 'sandbox-card-chargeback-not-wallet-inquiry') throw new Error('The journal does not establish the specified pre-reservation stop.');
  const batch = JSON.parse(await readFile(new URL(`../.data/batches/${batchId}.json`, import.meta.url), 'utf8'));
  const plan = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses: 10 });
  const item = plan.queue.find(entry => entry.key === key);
  const spec = replayFailureSpec(item);
  if (!item || spec.reason || !spec.disputeRequired || captured.amount?.value !== spec.captureAmount || captured.amount?.currency_code !== spec.currency) throw new Error('The captured amount or original dispute trial cannot be verified.');
  const root = join('.data', 'replay-ledger');
  if (await exists(join(root, 'keys', hash(key))) || await exists(join(root, 'captures', hash(captured.captureId))) || await exists(join(root, 'receipts', `${hash(key)}.json`))) throw new Error('A replay reservation or receipt already exists. Do not retry.');
  const adapter = createPayPalSandbox(await loadSandboxCredentials());
  const capture = await adapter.getCapture(captured.captureId);
  const dispute = await verifyReplayDispute({ adapter, disputeId: prior.disputeId, checkout: { state: 'captured', captureId: captured.captureId, buyerApprovalConfirmed: true, replayKey: key } });
  const result = { source: 'paypal-sandbox', claimId, key, captureId: captured.captureId, captureHttp: capture.status, captureStatus: capture.body?.status || null, dispute, action: 'none' };
  if (!capture.ok || capture.status !== 200 || capture.body?.id !== captured.captureId || capture.body?.status !== 'COMPLETED' || capture.body.amount?.value !== spec.captureAmount || capture.body.amount?.currency_code !== spec.currency || !dispute.verified) return { ...result, status: 'unverified', reason: 'Capture is not completed or its sandbox dispute is not unresolved and linked. No refund attempted.' };
  if (!execute) return { ...result, status: 'ready', reason: 'Verified in PayPal. Run with --execute to reserve once and replay.' };
  const dir = join('.data', 'pending-capture-recovery');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const journal = join(dir, `${claimId}.jsonl`);
  const f = await open(journal, 'wx', 0o600);
  try { await f.writeFile(`${JSON.stringify({ state: 'resume-requested', key, captureId: captured.captureId, disputeId: prior.disputeId, at: new Date().toISOString() })}\n`); await f.sync(); } finally { await f.close(); }
  if (await readFile(claimPath, 'utf8') !== raw) throw new Error('The claim changed. No refund was attempted.');
  const ledger = await createReplayLedger({ directory: root });
  const sessionId = randomUUID();
  let receipt;
  try { receipt = await ledger.execute({ item, sessionId, adapter, approval: { sessionId, captureId: captured.captureId, funding: 'paypal-sandbox-test-card', disputeId: prior.disputeId, disputeKind: 'sandbox-card-chargeback' } }); }
  catch { await append(journal, { state: 'outcome-unknown' }); throw new Error('Outcome unknown. Do not retry automatically.'); }
  const comparison = reconcileSandboxReplays({ plan: { ...plan, queue: [item] }, evidence: [receipt], verifyReceipt: ledger.verifyReceipt }).results[0];
  await append(journal, { state: 'finished', receiptSource: receipt.source, receiptStatus: receipt.status, reason: receipt.reason, comparison: comparison.status });
  return { ...result, action: 'replay-attempted-once', status: comparison.status, receipt, comparison, limitation: 'Sandbox only. External refund history and exclusive access remain unverified.' };
}

const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2 || (args[1] && args[1] !== '--execute')) { console.error('Usage: node server/resume-pending-capture.mjs CLAIM-ID [--execute]'); process.exitCode = 1; }
else try { console.log(JSON.stringify(await run(args[0], args[1] === '--execute'))); } catch (error) { console.error(error.message); process.exitCode = 1; }
