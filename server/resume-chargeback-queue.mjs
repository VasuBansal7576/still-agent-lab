import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';
import { createPayPalSandbox } from './paypal.mjs';
import { createReplayLedger } from './replay-ledger.mjs';
import { planSandboxReplays, reconcileSandboxReplays } from './sandbox-replay.mjs';
import { replayFailureSpec, verifyReplayDispute } from './replay-dispute.mjs';
import { passingReplaySpec } from './replay-passing-spec.mjs';

const base = 'https://api-m.sandbox.paypal.com';
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
async function append(file, value) { const handle = await open(file, 'a', 0o600); try { await handle.writeFile(`\n${JSON.stringify(value)}`); await handle.sync(); } finally { await handle.close(); } }
async function tokenFor(credentials) {
  const response = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.access_token !== 'string') throw new Error(`Sandbox authentication failed (HTTP ${response.status}).`);
  return body.access_token;
}

async function main() {
  const [batchId, limitArg = '5000', roundsArg = '2', mode = 'observe', personaId] = process.argv.slice(2);
  const limit = Number(limitArg), rounds = Number(roundsArg);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(batchId || '') || !Number.isSafeInteger(limit) || limit < 1 || limit > 5000 || !Number.isSafeInteger(rounds) || rounds < 1 || rounds > 10 || !['observe', 'execute'].includes(mode)) throw new Error('Usage: node server/resume-chargeback-queue.mjs BATCH-ID [limit 1..5000] [rounds 1..10] [observe|execute]');
  const batch = JSON.parse(await readFile(new URL(`../.data/batches/${batchId}.json`, import.meta.url), 'utf8'));
  const plan = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses: 10 });
  const items = new Map(plan.queue.map(item => [item.key, item]));
  const credentials = await loadSandboxCredentials();
  const adapter = createPayPalSandbox(credentials), token = await tokenFor(credentials);
  const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
  const prior = new Set((await ledger.evidence()).map(receipt => receipt.key));
  const root = '.data/bulk-replay-claims', pending = new Map();
  for (const name of await readdir(root)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const file = join(root, name);
    let raw, lines;
    try { raw = await readFile(file, 'utf8'); lines = raw.trim().split('\n').map(JSON.parse); } catch { continue; }
    const key = lines[0]?.key, captured = lines.find(line => line.state === 'captured'), last = lines.at(-1), item = items.get(key);
    if (!item || (personaId && item.personaId !== personaId) || prior.has(key) || hash(key) !== name.slice(0, 64) || last?.state !== 'chargeback-unverified' || last.http !== 201 || !captured?.ok || !validId(captured.captureId)) continue;
    const spec = item.status === 'fail' ? replayFailureSpec(item) : passingReplaySpec(item);
    if (spec.reason || !spec.disputeRequired || captured.amount?.value !== spec.captureAmount || captured.amount?.currency_code !== spec.currency) continue;
    pending.set(key, { file, raw, item, captured, spec });
    if (pending.size >= limit) break;
  }
  const totals = { selected: pending.size, inspected: 0, deferred: 0, ready: 0, attempted: 0, agreed: 0, disagreed: 0, unverified: 0, stopped: false };
  for (let round = 1; round <= rounds && pending.size; round++) {
    for (const [key, entry] of pending) {
      totals.inspected++;
      let capture;
      try { capture = await adapter.getCapture(entry.captured.captureId); } catch { totals.deferred++; continue; }
      if (!capture.ok || capture.status !== 200) { if (capture.status === 429 || capture.status >= 500 || capture.status === 401 || capture.status === 403) { totals.stopped = true; break; } totals.deferred++; continue; }
      if (capture.body?.id !== entry.captured.captureId || capture.body.status !== 'COMPLETED' || capture.body.amount?.value !== entry.spec.captureAmount || capture.body.amount?.currency_code !== entry.spec.currency) { totals.deferred++; continue; }
      const query = new URLSearchParams({ disputed_transaction_id: entry.captured.captureId, page_size: '50' });
      let response, body;
      try { response = await fetch(`${base}/v1/customer/disputes?${query}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000) }); body = await response.json().catch(() => ({})); } catch { totals.deferred++; continue; }
      if (!response.ok) { if (response.status === 429 || response.status >= 500 || response.status === 401 || response.status === 403) { totals.stopped = true; break; } totals.deferred++; continue; }
      const ids = Array.isArray(body.items) ? body.items.map(item => item.dispute_id).filter(validId) : [];
      if (ids.length !== 1 || body.links?.some(link => link.rel === 'next')) { totals.deferred++; continue; }
      const dispute = await verifyReplayDispute({ adapter, disputeId: ids[0], checkout: { state: 'captured', captureId: entry.captured.captureId, buyerApprovalConfirmed: true, replayKey: key } });
      if (!dispute.verified) { totals.deferred++; continue; }
      totals.ready++;
      if (mode === 'observe') { pending.delete(key); console.log(JSON.stringify({ source: 'paypal-sandbox', status: 'ready', captureId: entry.captured.captureId, disputeId: ids[0], scenario: 'sandbox-card-chargeback-not-wallet-inquiry' })); continue; }
      try { await mkdir(`${entry.file}.resume`, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') { pending.delete(key); continue; } throw error; }
      if (await readFile(entry.file, 'utf8') !== entry.raw) { pending.delete(key); totals.unverified++; continue; }
      await append(entry.file, { state: 'resume-requested', captureId: entry.captured.captureId, disputeId: ids[0], scenario: 'sandbox-card-chargeback-not-wallet-inquiry' });
      const sessionId = randomUUID();
      let receipt;
      try { receipt = await ledger.execute({ item: entry.item, sessionId, adapter, approval: { sessionId, captureId: entry.captured.captureId, funding: 'paypal-sandbox-test-card', disputeId: ids[0], disputeKind: 'sandbox-card-chargeback' } }); }
      catch { await append(entry.file, { state: 'outcome-unknown' }); totals.unverified++; totals.stopped = true; break; }
      await append(entry.file, { state: 'executed', source: receipt.source, status: receipt.status, reason: receipt.reason });
      totals.attempted++; pending.delete(key);
      const comparison = reconcileSandboxReplays({ plan: { ...plan, queue: [entry.item] }, evidence: [receipt], verifyReceipt: ledger.verifyReceipt }).results[0];
      if (comparison.status === 'agreed') totals.agreed++; else if (comparison.status === 'disagreed') totals.disagreed++; else totals.unverified++;
      console.log(JSON.stringify({ source: 'paypal-sandbox', captureId: entry.captured.captureId, disputeId: ids[0], scenario: 'sandbox-card-chargeback-not-wallet-inquiry', receiptStatus: receipt.status, comparison: comparison.status, reason: receipt.reason }));
      if (receipt.reason?.includes('uncertain') || receipt.attempts?.some(attempt => attempt.refund?.status === 429 || attempt.refund?.status >= 500 || attempt.refund?.status === 401 || attempt.refund?.status === 403)) { totals.stopped = true; break; }
    }
    console.log(JSON.stringify({ round, remaining: pending.size, ...totals }));
    if (totals.stopped || round === rounds || !pending.size) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(30000, 2000 * 2 ** (round - 1))));
  }
  console.log(JSON.stringify({ source: 'paypal-sandbox', mode, remaining: pending.size, ...totals }));
}
try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
