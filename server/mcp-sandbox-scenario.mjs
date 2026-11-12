import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSandboxTestCardCapture } from './batch-replay-runner.mjs';
import { createPayPalSandbox } from './paypal.mjs';
import { createReplayLedger } from './replay-ledger.mjs';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';
import { earnSandboxPermission, observeSandboxDisputes } from './sandbox-earned-gateway.mjs';
import { createSandboxScenarioGateway } from './sandbox-scenario-gateway.mjs';
import { createMcpHandler } from './toolkit-mcp.mjs';

const batchPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));

export async function createSandboxToolkitScenario(batchId) {
  if (!batchPattern.test(batchId || '')) throw new Error('A saved passing batch UUID is required.');
  const batch = JSON.parse(await readFile(new URL(`../.data/batches/${batchId}.json`, import.meta.url), 'utf8'));
  if (batch.id !== batchId) throw new Error('Saved batch identity does not match.');
  const directory = fileURLToPath(new URL('../.data/replay-ledger/', import.meta.url));
  const ledger = await createReplayLedger({ directory });
  const permission = await earnSandboxPermission({ batchId, batch, ledger });
  const credentials = await loadSandboxCredentials();
  const paypal = createPayPalSandbox(credentials);
  const runId = randomUUID();
  const journalDir = fileURLToPath(new URL('../.data/toolkit-sandbox-scenarios/', import.meta.url));
  await mkdir(journalDir, { recursive: true, mode: 0o700 });
  const journal = await open(`${journalDir}/${runId}.jsonl`, 'wx', 0o600);
  const record = async value => { await journal.writeFile(`${JSON.stringify(value)}\n`); await journal.sync(); };
  await record({ state: 'capture-requested', batchId, runId, source: 'paypal-sandbox', amount: '100.00', currency: 'USD' });
  let paid;
  try { paid = await createSandboxTestCardCapture({ amount: '100.00', currency: 'USD', credentials }); }
  catch { await record({ state: 'capture-outcome-unknown' }); await journal.close(); throw new Error('Sandbox capture outcome is unknown; do not retry this scenario.'); }
  await record({ state: paid.ok ? 'captured' : 'capture-unverified', capture: paid });
  if (!paid.ok) { await journal.close(); throw new Error('PayPal did not confirm the sandbox capture; do not retry this scenario.'); }
  const checkout = { state: 'captured', orderId: paid.orderId, captureId: paid.captureId, testCardCaptureConfirmed: true, capture: { id: paid.captureId, status: paid.captureStatus, amount: paid.amount } };
  const session = { checkout, captures: new Set([paid.captureId]), spent: new Set() };
  const { facts, gateway: earned } = await createSandboxScenarioGateway({ session, permission, credentials, ledgerDirectory: directory });
  let checked = false, lastRefundId;
  const gateway = { async call({ name, arguments: args }) {
    let result;
    if (name === 'get_order' && exactKeys(args, ['order_id']) && args.order_id === 'sandbox-order') {
      const capture = await paypal.getCapture(facts.captureId);
      result = capture.ok && capture.status === 200 && capture.body?.id === facts.captureId
        ? { ok: true, status: 200, body: { id: facts.orderId, status: capture.body.status, capture_id: facts.captureId, amount: capture.body.amount, source: 'paypal-sandbox', store_facts: 'synthetic' } }
        : { ok: false, reason: 'PayPal capture could not be verified.' };
    } else if (name === 'get_dispute' && exactKeys(args, ['dispute_id']) && args.dispute_id === 'sandbox-dispute') {
      const observation = await observeSandboxDisputes({ credentials, paypal, captureId: facts.captureId });
      checked = observation.allowed === true;
      result = checked ? { ok: true, status: 200, body: { id: 'sandbox-dispute', status: 'UNVERIFIED', observation: observation.observation, source: 'paypal-sandbox' } } : { ok: false, reason: observation.reason };
    } else if (name === 'create_refund' && exactKeys(args, ['capture_id', 'amount']) && args.capture_id === facts.captureId && exactKeys(args.amount, ['value', 'currency_code']) && checked) {
      const value = await earned.refund({ agentId: permission.agentId, captureId: facts.captureId, orderId: facts.orderId, customerId: facts.customerId, currency: args.amount.currency_code, amount: args.amount.value, decisionId: runId });
      if (value.result) {
        result = value.result;
        if (result.ok && typeof result.body?.id === 'string') lastRefundId = result.body.id;
      } else result = { ok: false, reason: value.reason || 'Sandbox gateway blocked the call.' };
    } else if (name === 'get_refund' && exactKeys(args, ['refund_id']) && args.refund_id === lastRefundId && lastRefundId) {
      result = await paypal.getRefund(lastRefundId);
    } else result = { ok: false, reason: 'The tool call does not match this controlled sandbox scenario.' };
    await record({ state: 'tool-result', name, result, source: 'paypal-sandbox', storeFacts: 'synthetic' });
    return result;
  } };
  return { gateway, sessionId: runId, decisionId: runId, close: () => journal.close() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node server/mcp-sandbox-scenario.mjs <passing-batch-uuid>');
  const binding = await createSandboxToolkitScenario(process.argv[2]);
  const handle = createMcpHandler(binding);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let chain = Promise.resolve();
  lines.on('line', line => {
    chain = chain.then(async () => {
      let message;
      try { message = JSON.parse(line); } catch { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`); return; }
      const response = await handle(message);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    });
  });
  lines.on('close', () => { chain.finally(() => binding.close()); });
}
