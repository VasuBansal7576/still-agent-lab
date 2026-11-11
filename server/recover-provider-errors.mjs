import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';
import { createPayPalSandbox } from './paypal.mjs';
import { createSandboxTestCardCapture } from './batch-replay-runner.mjs';

const expectedRunnerHash = '556694871b8dbb1db9b2b2cab0caaa09c4c916bf3f907fb64e910da59f77fc01';
const batchId = '40f79126-1d0a-4152-b23d-5ef9c221e7ce';
const digest = value => createHash('sha256').update(value).digest('hex');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value);

async function append(path, value) {
  const file = await open(path, 'a', 0o600);
  try { await file.writeFile(`${JSON.stringify(value)}\n`); await file.sync(); }
  finally { await file.close(); }
}

async function recover(claimId) {
  if (!/^[a-f0-9]{64}$/.test(claimId || '')) throw new Error('Provide one terminal sandbox 500 or 503 claim ID.');
  if (digest(await readFile(new URL('./batch-replay-runner.mjs', import.meta.url))) !== expectedRunnerHash) throw new Error('The order request implementation changed. Recovery is disabled.');
  const claimPath = join('.data', 'bulk-replay-claims', `${claimId}.json`);
  const original = await readFile(claimPath, 'utf8');
  const entries = original.split('\n').filter(Boolean).map(JSON.parse);
  if (entries.length !== 3 || entries[0]?.state !== 'reserved' || entries[1]?.state !== 'order-requested' || entries[2]?.state !== 'capture-unverified' || ![500, 503].includes(entries[2]?.http)) throw new Error('The claim is not a terminal sandbox 500/503 or has changed.');
  const claim = entries[0], request = entries[1];
  const age = Date.now() - Date.parse(claim.createdAt);
  if (!Number.isFinite(age) || age < 120000 || age >= 5 * 60 * 60 * 1000) throw new Error('The claim is too recent, expired or has an invalid timestamp.');
  let key;
  try { key = JSON.parse(claim.key); } catch { throw new Error('Invalid claim identity.'); }
  if (!Array.isArray(key) || key.length !== 3 || key[0] !== batchId || !/^persona-[a-f0-9]+$/.test(key[1] || '') || !Number.isSafeInteger(key[2]) || digest(claim.key) !== claimId) throw new Error('The claim identity does not match.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(request.requestId || '') || !/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(request.amount || '') || Number(request.amount) <= 0 || !/^[A-Z]{3}$/.test(request.currency || '')) throw new Error('The persisted order request is invalid.');
  try { await readFile(join('.data', 'replay-ledger', 'keys', digest(claim.key))); throw new Error('A replay reservation already exists.'); } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error; if (error.code === 'EISDIR') throw new Error('A replay reservation already exists.'); }
  const dir = join('.data', 'order-503-recovery');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const journal = join(dir, `${claimId}.jsonl`);
  const file = await open(journal, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify({ state: 'recovery-requested', claimId, key: claim.key, requestId: request.requestId, amount: request.amount, currency: request.currency, at: new Date().toISOString() })}\n`); await file.sync(); }
  finally { await file.close(); }
  const directoryHandle = await open(dir, 'r'); try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  if ((await readFile(claimPath, 'utf8')) !== original) throw new Error('The claim changed after reservation. No request was made.');
  let result;
  try { result = await createSandboxTestCardCapture({ amount: request.amount, currency: request.currency, credentials: await loadSandboxCredentials(), requestId: request.requestId }); }
  catch { await append(journal, { state: 'outcome-unknown', at: new Date().toISOString() }); throw new Error('PayPal outcome is unknown. Do not repeat this recovery.'); }
  if (!result.ok || !validId(result.orderId) || !validId(result.captureId)) {
    await append(journal, { state: 'unverified', http: result.http, name: result.name, issues: result.issues, at: new Date().toISOString() });
    throw new Error('PayPal did not confirm the order and capture. Do not repeat this recovery.');
  }
  const paypal = createPayPalSandbox(await loadSandboxCredentials());
  let capture;
  try { capture = await paypal.getCapture(result.captureId); }
  catch { await append(journal, { state: 'capture-lookup-unverified', orderId: result.orderId, captureId: result.captureId }); throw new Error('Capture lookup failed. Do not repeat this recovery.'); }
  const body = capture.body;
  if (!capture.ok || capture.status !== 200 || body?.id !== result.captureId || body?.status !== 'COMPLETED' || body?.amount?.value !== request.amount || body?.amount?.currency_code !== request.currency) {
    await append(journal, { state: 'capture-unverified', orderId: result.orderId, captureId: result.captureId, http: capture.status });
    throw new Error('PayPal did not verify the matching completed capture. Do not repeat this recovery.');
  }
  const record = { state: 'capture-verified', orderId: result.orderId, captureId: result.captureId, createHttp: result.http, captureHttp: capture.status, captureStatus: body.status, amount: body.amount, funding: 'paypal-sandbox-test-card', note: 'The original request ID was reused within documented retention. A previously unreceived request may create a new sandbox order. No refund was requested.' };
  await append(journal, record);
  return record;
}

try { console.log(JSON.stringify(await recover(process.argv[2]))); }
catch (error) { console.error(error.message); process.exitCode = 1; }
