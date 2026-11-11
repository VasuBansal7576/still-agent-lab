import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';
import { createPayPalSandbox } from './paypal.mjs';
import { createSandboxTestCardCapture } from './batch-replay-runner.mjs';

const frozen = new Set([
  '4ff648f1eb98cb8b9e452614673c0edf5b7c2756929f50d42c5bbe5a1ad810c5',
  '548ed9457f99f7bf1db30c3c27f717c76befb7caad56ad945fb203a0aa18c9f4',
  '6f0dccf73ea9eb6b4056bebe8db7211a3f5f6032f4e382de88d572c552d1d9fe',
  'c497a32748cd2c6966fc7d9a6a02cf7535cea2145b39bd1517446868dbfc448f',
  'd5fea041011066ad5fc86f1b916405d2c99ec8fcf63ad9ad617a29e0562f8755',
  'd81a65eda9d12a9ca516d46a92582459feb7b50fce28f6b3e26de34fb530981f',
  'dcde5531e097ba63ef0203b71d9d8aa4cf45489c714eb57b6c447a3da50af19f',
]);
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
  if (!frozen.has(claimId)) throw new Error('This claim is not in the frozen interrupted set.');
  const runner = await readFile(new URL('./batch-replay-runner.mjs', import.meta.url));
  if (digest(runner) !== expectedRunnerHash) throw new Error('The original order request implementation changed. Recovery is disabled.');
  const claimPath = join('.data', 'bulk-replay-claims', `${claimId}.json`);
  const original = await readFile(claimPath, 'utf8');
  const entries = original.split('\n').filter(Boolean).map(JSON.parse);
  if (entries.length !== 2 || entries[0].state !== 'reserved' || entries[1].state !== 'order-requested') throw new Error('The frozen claim has changed or is ambiguous.');
  const claim = entries[0], request = entries[1];
  const created = Date.parse(claim.createdAt), age = Date.now() - created;
  if (!Number.isFinite(created) || created < Date.parse('2026-11-11T18:28:45Z') || created >= Date.parse('2026-11-11T18:29:00Z') || age < 0 || age >= 5 * 60 * 60 * 1000) throw new Error('The claim is outside the frozen set or safe recovery window.');
  let key;
  try { key = JSON.parse(claim.key); } catch { throw new Error('Invalid claim identity.'); }
  if (!Array.isArray(key) || key.length !== 3 || key[0] !== batchId || !/^persona-[a-f0-9]+$/.test(key[1] || '') || !Number.isSafeInteger(key[2]) || digest(claim.key) !== claimId) throw new Error('The claim identity does not match.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(request.requestId || '') || !/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(request.amount || '') || Number(request.amount) <= 0 || request.currency !== 'GBP') throw new Error('The persisted order request is invalid.');
  const dir = join('.data', 'frozen-order-recovery');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const journal = join(dir, `${claimId}.jsonl`);
  const file = await open(journal, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify({ state: 'recovery-requested', claimId, key: claim.key, requestId: request.requestId, amount: request.amount, currency: request.currency, at: new Date().toISOString() })}\n`); await file.sync(); }
  finally { await file.close(); }
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
  if (!capture.ok || capture.status !== 200 || body?.id !== result.captureId || body?.amount?.value !== request.amount || body?.amount?.currency_code !== request.currency) {
    await append(journal, { state: 'capture-unverified', orderId: result.orderId, captureId: result.captureId, http: capture.status });
    throw new Error('PayPal did not verify the matching capture. Do not repeat this recovery.');
  }
  const record = { state: 'capture-verified', orderId: result.orderId, captureId: result.captureId, createHttp: result.http, captureHttp: capture.status, captureStatus: body.status, amount: body.amount, funding: 'paypal-sandbox-test-card', note: 'Same request ID within documented retention. A previously unreceived request may create a new sandbox order. No refund was requested.' };
  await append(journal, record);
  return record;
}

try { console.log(JSON.stringify(await recover(process.argv[2]))); }
catch (error) { console.error(error.message); process.exitCode = 1; }
