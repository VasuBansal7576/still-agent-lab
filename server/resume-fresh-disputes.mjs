import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';
import { createPayPalSandbox } from './paypal.mjs';
import { createReplayLedger } from './replay-ledger.mjs';
import { planSandboxReplays, reconcileSandboxReplays } from './sandbox-replay.mjs';
import { replayFailureSpec, verifyReplayDispute } from './replay-dispute.mjs';

const base = 'https://api-m.sandbox.paypal.com';
const digest = value => createHash('sha256').update(value).digest('hex');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value);
async function append(file, value) { const handle = await open(file, 'a', 0o600); try { await handle.writeFile(`\n${JSON.stringify(value)}`); await handle.sync(); } finally { await handle.close(); } }

async function main() {
  const [batchId, limitArg = '5000', workersArg = '4'] = process.argv.slice(2);
  const limit = Number(limitArg), concurrency = Number(workersArg);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(batchId || '') || !Number.isSafeInteger(limit) || limit < 1 || limit > 5000 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Usage: node server/resume-fresh-disputes.mjs BATCH-ID LIMIT(1..5000) WORKERS(1..4)');
  const batch = JSON.parse(await readFile(`.data/batches/${batchId}.json`, 'utf8'));
  if (!batch.replacementOf?.batchId || !Array.isArray(batch.replacementOf.originalKeys)) throw new Error('This command accepts only a server-created fresh replacement batch.');
  const plan = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses: 0 });
  const items = new Map(plan.queue.map(item => [item.key, item]));
  const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
  const prior = new Set((await ledger.evidence()).map(receipt => receipt.key));
  const credentials = await loadSandboxCredentials();
  const tokenResponse = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const tokenBody = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || typeof tokenBody.access_token !== 'string') throw new Error(`Sandbox authentication failed (HTTP ${tokenResponse.status}).`);
  const token = tokenBody.access_token, adapter = createPayPalSandbox(credentials), root = '.data/bulk-replay-claims';
  const candidates = [];
  for (const name of (await readdir(root)).sort()) {
    if (candidates.length >= limit) break;
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const file = join(root, name);
    let raw, lines;
    try { raw = await readFile(file, 'utf8'); lines = raw.trim().split('\n').map(JSON.parse); } catch { continue; }
    const key = lines[0]?.key, captured = lines.find(line => line.state === 'captured'), item = items.get(key), last = lines.at(-1);
    if (!item || prior.has(key) || digest(key) !== name.slice(0, 64) || last?.state !== 'chargeback-unverified' || last.http !== 201 || !captured?.ok || !validId(captured.captureId)) continue;
    const spec = replayFailureSpec(item);
    if (spec.reason || !spec.disputeRequired || captured.amount?.value !== spec.captureAmount || captured.amount?.currency_code !== spec.currency) continue;
    candidates.push({ key, file, raw, item, captured, spec });
  }
  const totals = { selected: candidates.length, inspected: 0, deferred: 0, ready: 0, attempted: 0, agreed: 0, disagreed: 0, unverified: 0, stopped: false };
  let next = 0;
  async function worker() {
    while (!totals.stopped && next < candidates.length) {
      const entry = candidates[next++]; totals.inspected++;
      let capture;
      try { capture = await adapter.getCapture(entry.captured.captureId); } catch { totals.stopped = true; break; }
      if (!capture.ok || capture.status !== 200) { if ([401, 403, 429].includes(capture.status) || capture.status >= 500) { totals.stopped = true; break; } totals.deferred++; continue; }
      if (capture.body?.id !== entry.captured.captureId || capture.body.status !== 'COMPLETED' || capture.body.amount?.value !== entry.spec.captureAmount || capture.body.amount?.currency_code !== entry.spec.currency) { totals.deferred++; continue; }
      const query = new URLSearchParams({ disputed_transaction_id: entry.captured.captureId, page_size: '50' });
      let response, body;
      try { response = await fetch(`${base}/v1/customer/disputes?${query}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000) }); body = await response.json().catch(() => ({})); } catch { totals.stopped = true; break; }
      if (!response.ok) { if ([401, 403, 429].includes(response.status) || response.status >= 500) { totals.stopped = true; break; } totals.deferred++; continue; }
      const ids = Array.isArray(body.items) ? body.items.map(item => item.dispute_id).filter(validId) : [];
      if (ids.length !== 1 || body.links?.some(link => link.rel === 'next')) { totals.deferred++; continue; }
      const dispute = await verifyReplayDispute({ adapter, disputeId: ids[0], checkout: { state: 'captured', captureId: entry.captured.captureId, buyerApprovalConfirmed: true, replayKey: entry.key } });
      if (!dispute.verified) { if ([401, 403, 429].includes(dispute.httpStatus) || dispute.httpStatus >= 500 || dispute.reason === 'Sandbox dispute lookup failed.') { totals.stopped = true; break; } totals.deferred++; continue; }
      totals.ready++;
      try { await mkdir(`${entry.file}.resume`, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') continue; throw error; }
      if (await readFile(entry.file, 'utf8') !== entry.raw) { totals.unverified++; continue; }
      await append(entry.file, { state: 'resume-requested', captureId: entry.captured.captureId, disputeId: ids[0], scenario: 'sandbox-card-chargeback-not-wallet-inquiry' });
      const sessionId = randomUUID();
      let receipt;
      try { receipt = await ledger.execute({ item: entry.item, sessionId, adapter, approval: { sessionId, captureId: entry.captured.captureId, funding: 'paypal-sandbox-test-card', disputeId: ids[0], disputeKind: 'sandbox-card-chargeback' } }); }
      catch { await append(entry.file, { state: 'outcome-unknown' }); totals.unverified++; totals.stopped = true; break; }
      await append(entry.file, { state: 'executed', source: receipt.source, status: receipt.status, reason: receipt.reason });
      totals.attempted++;
      const result = reconcileSandboxReplays({ plan: { ...plan, queue: [entry.item] }, evidence: [receipt], verifyReceipt: ledger.verifyReceipt }).results[0];
      if (result.status === 'agreed') totals.agreed++; else if (result.status === 'disagreed') totals.disagreed++; else totals.unverified++;
      console.log(JSON.stringify({ source: 'paypal-sandbox', captureId: entry.captured.captureId, disputeId: ids[0], receiptStatus: receipt.status, comparison: result.status, reason: receipt.reason }));
      if (receipt.reason?.includes('uncertain') || receipt.attempts?.some(attempt => [401, 403, 429].includes(attempt.refund?.status) || attempt.refund?.status >= 500)) totals.stopped = true;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  console.log(JSON.stringify({ source: 'paypal-sandbox', ...totals }));
}
try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
