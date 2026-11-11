import { readdir, readFile } from 'node:fs/promises';
import { createPayPalSandbox } from './paypal.mjs';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';

const base = 'https://api-m.sandbox.paypal.com';
const credentials = await loadSandboxCredentials();
const adapter = createPayPalSandbox(credentials);
const tokenResponse = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', redirect: 'error', headers: { Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
const token = (await tokenResponse.json()).access_token;
if (!tokenResponse.ok || !token) throw new Error(`Sandbox authentication failed (HTTP ${tokenResponse.status}).`);
const filter = process.argv[2];
if (filter && !/^[A-Za-z0-9_-]{1,127}$/.test(filter)) throw new Error('Invalid capture ID.');
const directory = '.data/bulk-replay-claims';
const output = [];
for (const filename of await readdir(directory)) {
  if (!/^[a-f0-9]{64}\.json$/.test(filename)) continue;
  const lines = (await readFile(`${directory}/${filename}`, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const captureId = lines.find(line => line.state === 'captured')?.captureId;
  if (lines.at(-1).state !== 'chargeback-unverified' || !captureId || (filter && captureId !== filter)) continue;
  const query = new URLSearchParams({ disputed_transaction_id: captureId, page_size: '50' });
  const response = await fetch(`${base}/v1/customer/disputes?${query}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  const body = await response.json().catch(() => ({}));
  const ids = Array.isArray(body.items) ? body.items.map(item => item.dispute_id).filter(id => /^[A-Za-z0-9_-]{1,127}$/.test(id || '')) : [];
  if (!response.ok || ids.length !== 1 || body.links?.some(link => link.rel === 'next')) { output.push({ captureId, status: 'unverified', reason: 'No unique dispute was returned.', http: response.status }); continue; }
  const detail = await adapter.getAccountDispute(ids[0]);
  const linked = detail.ok && detail.body?.id === ids[0] && Array.isArray(detail.body.sellerTransactionIds) && detail.body.sellerTransactionIds.length === 1 && detail.body.sellerTransactionIds[0] === captureId;
  const open = linked && ['OPEN', 'UNDER_REVIEW', 'WAITING_FOR_SELLER_RESPONSE', 'WAITING_FOR_BUYER_RESPONSE'].includes(detail.body.status);
  output.push({ captureId, disputeId: ids[0], status: open ? 'linked-open' : 'unverified', providerStatus: detail.body?.status, http: detail.status, note: 'Sandbox card chargeback; no refund or new chargeback was sent.' });
}
console.log(JSON.stringify({ source: 'paypal-sandbox', results: output }, null, 2));
