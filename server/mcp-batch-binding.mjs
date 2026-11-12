import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGateway, derivePermission } from './gateway.mjs';
import { createPayPalMock } from './paypal-mock.mjs';
import { createMcpHandler } from './toolkit-mcp.mjs';

const directory = fileURLToPath(new URL('../.data/batches/', import.meta.url)).replace(/\/$/, '');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function createBatchBinding(batchId) {
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
  if (summary.protocolVersion === 3 || summary.results?.some(item => item.toolkitProtocol === true)) throw new Error('Toolkit-style trial batches cannot yet bind the MCP gateway.');
  if (!Array.isArray(summary.results) || !Number.isInteger(summary.personaCount) || !Number.isInteger(summary.trials) || summary.personaCount < 1 || summary.trials < 1 || summary.results.length !== summary.personaCount * summary.trials || summary.results.some(item => item.status !== 'pass')) throw new Error('Batch is incomplete or contains a failure.');
  const identities = new Set(summary.results.map(item => `${item.personaId}\0${item.trial}`));
  if (identities.size !== summary.results.length || new Set(summary.results.map(item => item.personaId)).size !== summary.personaCount || summary.results.some(item => typeof item.personaId !== 'string' || !item.personaId || !Number.isInteger(item.trial) || item.trial < 1 || item.trial > summary.trials)) throw new Error('Batch trial identities are incomplete.');
  const results = summary.results.filter(item => item.finalPayment?.amount?.currency_code === 'USD');
  const evidence = { ...summary, results, personaCount: new Set(results.map(item => item.personaId)).size };
  const permission = derivePermission({ agentId: summary.evaluatedAgentId, currency: 'USD', summary: evidence });
  if (!permission.create_refund.allowed) throw new Error('Batch did not earn a USD mock refund permission.');

  const amount = permission.create_refund.maxPerOrder;
  const scenario = { kind: 'partial-return', amount, approvedReturn: amount, currency: 'USD', orderId: 'batch-order', customerId: 'batch-customer' };
  const mock = createPayPalMock(scenario, 'batch');
  const adapter = {
    trusted: true, replaySafe: true, stableRequestIds: true,
    async inspect(captureId) {
      const payment = mock.snapshot();
      const remaining = (Number(amount) - Number(payment.refunded)).toFixed(2);
      return { captureId: payment.id, paymentStatus: payment.status, currency: 'USD', disputeState: 'CLEAR', disputeId: 'batch-dispute', identityMatches: captureId === payment.id, cancellationComplete: false, remaining, approvedAmount: remaining, refundedToDate: payment.refunded };
    },
    async refund(captureId, args) { return mock.refund({ ...args, captureId }); },
    async get_order(orderId) { return orderId === scenario.orderId ? { ok: true, status: 200, body: { id: orderId, status: 'COMPLETED', amount: mock.snapshot().amount } } : { ok: false, status: 404 }; },
    async get_refund(refundId) { const refund = mock.snapshot().refunds.find(item => item.id === refundId); return refund ? { ok: true, status: 200, body: refund } : { ok: false, status: 404 }; },
    async get_dispute(disputeId) { return { ok: true, status: 200, body: { id: disputeId, status: 'CLEAR' } }; }
  };
  return { gateway: createGateway({ agentId: summary.evaluatedAgentId, permission, adapter }), sessionId: 'stdio-batch', decisionId: 'batch-refund-decision' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node server/mcp-batch-binding.mjs <batch-uuid>');
  const handle = createMcpHandler(await createBatchBinding(process.argv[2]));
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
