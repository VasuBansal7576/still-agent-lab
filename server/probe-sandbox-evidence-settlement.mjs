import { mkdir, open } from 'node:fs/promises';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';

const base = 'https://api-m.sandbox.paypal.com';
const captureId = '7TF93436A04568915';
const disputeId = 'PP-R-JJJ-10199975';
const directory = '.data/evidence-settlement-probe';

async function append(value) {
  const file = await open(`${directory}/journal.jsonl`, 'a', 0o600);
  try { await file.writeFile(`${JSON.stringify(value)}\n`); await file.sync(); }
  finally { await file.close(); }
}

async function main() {
  const credentials = await loadSandboxCredentials();
  const auth = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const token = (await auth.json().catch(() => ({}))).access_token;
  if (!auth.ok || typeof token !== 'string') throw new Error(`Sandbox authentication failed (HTTP ${auth.status}).`);
  async function get(path) {
    const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    return { http: response.status, body: await response.json().catch(() => ({})) };
  }
  async function state() {
    const [capture, dispute] = await Promise.all([get(`/v2/payments/captures/${captureId}`), get(`/v1/customer/disputes/${disputeId}`)]);
    return { capture: { http: capture.http, id: capture.body.id, status: capture.body.status }, dispute: { http: dispute.http, id: dispute.body.dispute_id, status: dispute.body.status, stage: dispute.body.dispute_life_cycle_stage, linked: (dispute.body.disputed_transactions || []).some(item => item.seller_transaction_id === captureId), evidenceRequested: (dispute.body.evidences || []).some(item => item.evidence_type === 'OTHER' && item.source === 'REQUESTED_FROM_SELLER'), canProvideEvidence: (dispute.body.links || []).some(item => item.rel === 'provide_evidence' && item.method === 'POST'), canAdjudicate: (dispute.body.links || []).some(item => item.rel === 'adjudicate' && item.method === 'POST') } };
  }
  const before = await state();
  if (before.capture.http !== 200 || before.capture.id !== captureId || before.capture.status !== 'PENDING' || before.dispute.http !== 200 || before.dispute.id !== disputeId || before.dispute.status !== 'WAITING_FOR_SELLER_RESPONSE' || before.dispute.stage !== 'CHARGEBACK' || !before.dispute.linked || !before.dispute.evidenceRequested || !before.dispute.canProvideEvidence) throw new Error('Sandbox case is not in the expected state; no evidence was submitted.');
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('A probe reservation already exists; do not repeat.'); throw error; }
  await append({ state: 'before', at: new Date().toISOString(), ...before });
  await append({ state: 'submission-requested', at: new Date().toISOString(), evidenceType: 'OTHER' });
  const form = new FormData();
  form.append('input', new Blob([JSON.stringify({ evidences: [{ evidence_type: 'OTHER', notes: 'Synthetic sandbox dispute test. No real goods or customer are involved.' }] })], { type: 'application/json' }));
  let response;
  try { response = await fetch(`${base}/v1/customer/disputes/${disputeId}/provide-evidence`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
  catch { await append({ state: 'outcome-unknown', at: new Date().toISOString() }); throw new Error('Sandbox evidence submission outcome is unknown; do not retry.'); }
  const body = await response.json().catch(() => ({}));
  await append({ state: 'submission-response', at: new Date().toISOString(), http: response.status, name: body.name, issues: (body.details || []).map(item => item.issue).filter(Boolean) });
  if ([401, 403, 429].includes(response.status) || response.status >= 500) throw new Error(`Sandbox evidence submission returned HTTP ${response.status}; do not retry.`);
  const after = await state();
  await append({ state: 'after', at: new Date().toISOString(), ...after });
  console.log(JSON.stringify({ source: 'paypal-sandbox', before, submission: { http: response.status, name: body.name, issues: (body.details || []).map(item => item.issue).filter(Boolean) }, after, note: 'This changes one sandbox dispute. It does not replay the original open-dispute scenario and sends no refund.' }, null, 2));
}

try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
