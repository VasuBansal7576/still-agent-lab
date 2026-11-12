import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGateway, derivePermission } from './gateway.mjs';
import { createPayPalMock } from './paypal-mock.mjs';
import { createMcpHandler } from './toolkit-mcp.mjs';

const directory = fileURLToPath(new URL('../.data/batches/', import.meta.url)).replace(/\/$/, '');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function createBatchBinding(batchId, { decisionId } = {}) {
  if (!uuid.test(batchId || '')) throw new Error('Supply a batch UUID from the host batch store.');
  if (await realpath(directory) !== directory) throw new Error('The batch directory must not be a symlink.');
  const file = await open(`${directory}/${batchId}.json`, constants.O_RDONLY | constants.O_NOFOLLOW);
  let summary;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 100 * 1024 * 1024) throw new Error('Invalid batch file.');
    summary = JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
  if (summary.id !== batchId) throw new Error('Batch identity does not match its file.');
  const toolkitTrial = summary.protocolVersion === 3 || summary.results?.some(item => item.toolkitProtocol === true);
  if (toolkitTrial && (typeof decisionId !== 'string' || !/^[A-Za-z0-9_-]{1,127}$/.test(decisionId))) throw new Error('Toolkit-style binding requires an explicit decision ID from the host.');
  if (!Array.isArray(summary.results) || !Number.isInteger(summary.personaCount) || !Number.isInteger(summary.trials) || summary.personaCount < 1 || summary.trials < 1 || summary.results.length !== summary.personaCount * summary.trials || summary.results.some(item => item.status !== 'pass')) throw new Error('Batch is incomplete or contains a failure.');
  const identities = new Set(summary.results.map(item => `${item.personaId}\0${item.trial}`));
  if (identities.size !== summary.results.length || new Set(summary.results.map(item => item.personaId)).size !== summary.personaCount || summary.results.some(item => typeof item.personaId !== 'string' || !item.personaId || !Number.isInteger(item.trial) || item.trial < 1 || item.trial > summary.trials)) throw new Error('Batch trial identities are incomplete.');
  const results = summary.results.filter(item => item.finalPayment?.amount?.currency_code === 'USD');
  const evidence = { ...summary, results, personaCount: new Set(results.map(item => item.personaId)).size };
  const permission = derivePermission({ agentId: summary.evaluatedAgentId, currency: 'USD', summary: evidence });
  if (!permission.create_refund.allowed) throw new Error('Batch did not earn a USD mock refund permission.');

  return createMockBatchBinding({ permission, agentId: summary.evaluatedAgentId, toolkitTrial, decisionId });
}

export function createMockBatchBinding({ permission, agentId, toolkitTrial = true, decisionId } = {}) {
  if (permission?.scope !== 'deterministic-mock' || permission?.agentId !== agentId || permission?.create_refund?.allowed !== true || permission.create_refund.currency !== 'USD' || !/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(permission.create_refund.maxPerOrder || '') || Number(permission.create_refund.maxPerOrder) <= 0 || (toolkitTrial && (typeof decisionId !== 'string' || !/^[A-Za-z0-9_-]{1,127}$/.test(decisionId)))) throw new Error('A valid mock permission and decision ID are required.');
  const amount = permission.create_refund.maxPerOrder;
  const orderId = toolkitTrial ? '8AA00000BB000000C' : 'batch-order';
  const captureId = toolkitTrial ? '9AA00000BB000000C' : 'MOCK-CAPTURE-batch';
  const scenario = { kind: 'partial-return', amount, approvedReturn: amount, currency: 'USD', orderId, customerId: 'batch-customer' };
  const mock = createPayPalMock(scenario, 'batch');
  const adapter = {
    trusted: true, replaySafe: true, stableRequestIds: true, ...(toolkitTrial ? { disputeListCoverage: 'capture-complete' } : {}),
    async inspect(requestedCapture) {
      const payment = mock.snapshot();
      const remaining = (Number(amount) - Number(payment.refunded)).toFixed(2);
      return { captureId, paymentStatus: payment.status, currency: 'USD', disputeState: 'CLEAR', disputeId: toolkitTrial ? null : 'batch-dispute', identityMatches: requestedCapture === captureId, cancellationComplete: false, remaining, approvedAmount: remaining, refundedToDate: payment.refunded };
    },
    async refund(requestedCapture, args) { return mock.refund({ ...args, captureId: requestedCapture === captureId ? mock.snapshot().id : requestedCapture }); },
    async get_order(requestedOrder) { return requestedOrder === scenario.orderId ? { ok: true, status: 200, body: { id: requestedOrder, status: 'COMPLETED', amount: mock.snapshot().amount, ...(toolkitTrial ? { capture_id: captureId } : {}) } } : { ok: false, status: 404 }; },
    async get_refund(refundId) { const refund = mock.snapshot().refunds.find(item => item.id === refundId); return refund ? { ok: true, status: 200, body: refund } : { ok: false, status: 404 }; },
    async get_dispute(disputeId) { return toolkitTrial ? { ok: false, status: 404 } : { ok: true, status: 200, body: { id: disputeId, status: 'CLEAR' } }; },
    async list_disputes(requestedCapture) { return toolkitTrial && requestedCapture === captureId ? { ok: true, status: 200, body: { disputed_transaction_id: captureId, complete: true, items: [] } } : { ok: false, status: 404 }; }
  };
  return { gateway: createGateway({ agentId, permission, adapter }), permission, sessionId: 'stdio-batch', decisionId: toolkitTrial ? decisionId : 'batch-refund-decision', protocolVersion: toolkitTrial ? 3 : 2 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length < 3 || process.argv.length > 4) throw new Error('Usage: node server/mcp-batch-binding.mjs <batch-uuid> [decision-id]');
  const handle = createMcpHandler(await createBatchBinding(process.argv[2], { decisionId: process.argv[3] }));
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let queue = Promise.resolve();
  lines.on('line', line => {
    queue = queue.then(async () => {
      let message;
      try { message = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); return; }
      const response = await handle(message);
      if (response) process.stdout.write(JSON.stringify(response) + '\n');
    });
  });
}
