import { randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';
import { createSandboxTestCardCapture } from './batch-replay-runner.mjs';

const base = 'https://api-m.sandbox.paypal.com';
const root = '.data/sandbox-funding-capture-probe';
const credentials = await loadSandboxCredentials();
const auth = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
const token = await auth.json().catch(() => ({}));
if (!auth.ok || !token.access_token) throw new Error(`Sandbox authentication failed (HTTP ${auth.status}).`);
const headers = { Authorization: `Bearer ${token.access_token}` };
async function balances() {
  const response = await fetch(`${base}/v1/reporting/balances`, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
  const body = await response.json().catch(() => ({}));
  return { http: response.status, asOf: body.as_of_time, lastRefresh: body.last_refresh_time, balances: (body.balances || []).map(({ currency, available_balance }) => ({ currency, available: available_balance })) };
}
const before = await balances();
await mkdir(root, { recursive: true, mode: 0o700 });
let journal;
try { journal = await open(`${root}/attempt.jsonl`, 'wx', 0o600); }
catch (error) { if (error.code === 'EEXIST') throw new Error('Funding capture probe already reserved; do not repeat.'); throw error; }
const requestId = randomUUID();
try { await journal.writeFile(`${JSON.stringify({ state: 'reserved', requestId, before })}\n`); await journal.sync(); }
finally { await journal.close(); }
let capture;
try { capture = await createSandboxTestCardCapture({ credentials, amount: '100.00', currency: 'GBP', requestId }); }
catch { throw new Error('Sandbox capture outcome unknown; do not repeat.'); }
journal = await open(`${root}/attempt.jsonl`, 'a', 0o600);
try { await journal.writeFile(`${JSON.stringify({ state: 'capture-result', capture })}\n`); await journal.sync(); } finally { await journal.close(); }
if (!capture.ok) throw new Error(`Sandbox capture not confirmed (HTTP ${capture.http}); do not repeat.`);
const response = await fetch(`${base}/v2/payments/captures/${capture.captureId}`, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
const detail = await response.json().catch(() => ({}));
const after = await balances();
const evidence = { source: 'paypal-sandbox', funding: 'sandbox-test-card', before, capture, captureRead: { http: response.status, id: detail.id, status: detail.status, amount: detail.amount, sellerReceivable: detail.seller_receivable_breakdown }, after, note: 'Balance reporting can lag up to three hours. No refunds were sent. This does not establish a usable GBP balance.' };
journal = await open(`${root}/attempt.jsonl`, 'a', 0o600);
try { await journal.writeFile(`${JSON.stringify({ state: 'observed', evidence })}\n`); await journal.sync(); } finally { await journal.close(); }
console.log(JSON.stringify(evidence));
