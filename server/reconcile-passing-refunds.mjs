import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createReplayLedger } from './replay-ledger.mjs';
import { planSandboxReplays } from './sandbox-replay.mjs';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';

const base = 'https://api-m.sandbox.paypal.com';
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value);

export async function reconcilePassingRefunds(batchId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(batchId || '')) throw new Error('A valid batch ID is required.');
  const batch = JSON.parse(await readFile(new URL(`../.data/batches/${batchId}.json`, import.meta.url), 'utf8'));
  const plan = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses: 10 });
  const items = new Map(plan.queue.filter(item => item.status === 'pass').map(item => [item.key, item]));
  const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
  const receipts = (await ledger.evidence()).filter(receipt => items.has(receipt.key) && receipt.source === 'unverified-executor' && receipt.refund?.status === 201 && validId(receipt.refund.body?.id) && validId(receipt.capture?.body?.id) && ledger.verifyReceipt(receipt, items.get(receipt.key)));
  const credentials = await loadSandboxCredentials();
  const response = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const auth = await response.json().catch(() => ({}));
  if (!response.ok || typeof auth.access_token !== 'string') throw new Error(`Sandbox authentication failed (HTTP ${response.status}).`);
  const get = async path => {
    const result = await fetch(`${base}${path}`, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' } });
    return { http: result.status, body: await result.json().catch(() => ({})) };
  };
  const results = [];
  for (const receipt of receipts) {
    const item = items.get(receipt.key), captureId = receipt.capture.body.id, refundId = receipt.refund.body.id;
    const refund = await get(`/v2/payments/refunds/${refundId}`);
    const capture = await get(`/v2/payments/captures/${captureId}`);
    const linkMatches = (Array.isArray(refund.body.links) ? refund.body.links : []).some(link => {
      try { const url = new URL(link.href); return link.rel === 'up' && url.protocol === 'https:' && ['api.sandbox.paypal.com', 'api-m.sandbox.paypal.com'].includes(url.hostname) && url.pathname === `/v2/payments/captures/${captureId}`; } catch { return false; }
    });
    const mockRefund = item.events.find(event => event.type === 'tool_result' && event.tool === 'create_refund')?.response?.body;
    const expected = receipt.refund.body.amount;
    const verified = refund.http === 200 && capture.http === 200 && refund.body.id === refundId && capture.body.id === captureId && ['PENDING', 'COMPLETED', 'CANCELLED', 'FAILED'].includes(refund.body.status) && linkMatches && capture.body.amount?.value === receipt.capture.body.amount?.value && capture.body.amount?.currency_code === receipt.capture.body.amount?.currency_code && refund.body.amount?.value === expected?.value && refund.body.amount?.currency_code === expected?.currency_code && mockRefund?.amount?.value === expected?.value && mockRefund?.amount?.currency_code === expected?.currency_code;
    results.push({ personaId: item.personaId, trial: item.trial, captureId, refundId, refundHttp: refund.http, captureHttp: capture.http, refundStatus: refund.body.status, captureStatus: capture.body.status, amount: refund.body.amount && { value: refund.body.amount.value, currency_code: refund.body.amount.currency_code }, linkedCaptureVerified: linkMatches, mockStatus: mockRefund?.status, comparison: verified ? (refund.body.status === mockRefund.status ? 'agreed' : 'disagreed') : 'unverified' });
  }
  return { batchId, observedAt: new Date().toISOString(), source: 'paypal-sandbox', timing: 'later-read-only-observation', results, note: 'Current PayPal refund and capture state only. This does not change the original replay receipt or establish the original response timing, completed refund, complete refund history, or exclusive account access.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await reconcilePassingRefunds(process.argv[2]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
