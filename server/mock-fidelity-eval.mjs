import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPayPalMock } from './paypal-mock.mjs';
import { createReplayLedger } from './replay-ledger.mjs';
import { planSandboxReplays } from './sandbox-replay.mjs';

const batchId = '40f79126-1d0a-4152-b23d-5ef9c221e7ce';
const batch = JSON.parse(await readFile(`.data/batches/${batchId}.json`, 'utf8'));
const pilot = JSON.parse(await readFile('docs/evidence/sandbox-bulk-pilot.json', 'utf8'));
const pilotKeys = new Set(pilot.examples.map(example => example.key));
const plan = planSandboxReplays({ batchId, batch, maxRuns: batch.results.length, samplePasses: 10 });
const items = new Map(plan.queue.map(item => [item.key, item]));
const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
const counts = { eligible: 0, completed: 0, sandboxTestCard: 0, pending: 0, chargeback: 0, other: 0 };
const excluded = { outsideBatch: 0, pilot: 0, hashSplit: 0, untrusted: 0, nonTestCard: 0, incompleteOrUnsupported: 0 };
const comparable = response => response.ok
  ? { status: response.status, outcome: response.body?.status, amount: response.body?.amount }
  : { status: response.status, issue: response.body?.details?.[0]?.issue };
const receipts = await ledger.evidence();
for (const receipt of receipts) {
  const item = items.get(receipt.key);
  if (!item) { excluded.outsideBatch++; continue; }
  if (pilotKeys.has(receipt.key)) { excluded.pilot++; continue; }
  if (createHash('sha256').update(receipt.key).digest('hex')[0] !== '0') { excluded.hashSplit++; continue; }
  if (!ledger.verifyReceipt(receipt, item) || receipt.source !== 'paypal-sandbox' || receipt.simulated !== false) { excluded.untrusted++; continue; }
  if (receipt.funding !== 'paypal-sandbox-test-card') { excluded.nonTestCard++; continue; }
  const capture = receipt.capture?.body, first = receipt.attempts?.[0];
  const response = first?.refund, request = first?.request;
  if (!receipt.capture?.ok || capture?.status !== 'COMPLETED' || !capture.amount || !response || !request || !(response.status === 201 || response.status === 422)) { excluded.incompleteOrUnsupported++; continue; }
  const scenario = { amount: capture.amount.value, currency: capture.amount.currency_code, kind: 'partial-return', disputeOpen: receipt.disputeKind === 'sandbox-card-chargeback' };
  const args = { amount: request.amount, currency: request.currency, requestId: 'holdout-decision' };
  const actual = comparable(response);
  const baseline = comparable(createPayPalMock(scenario, 'baseline').refund(args));
  const profile = comparable(createPayPalMock({ ...scenario, mockProfile: 'sandbox-test-card' }, 'profile').refund(args));
  counts.eligible++;
  if (JSON.stringify(actual) === JSON.stringify(baseline)) counts.completed++;
  if (JSON.stringify(actual) === JSON.stringify(profile)) counts.sandboxTestCard++;
  if (actual.outcome === 'PENDING') counts.pending++;
  else if (actual.issue === 'REFUND_NOT_PERMITTED_DUE_TO_CHARGEBACK') counts.chargeback++;
  else counts.other++;
}
console.log(JSON.stringify({ source: 'authenticated-sandbox-replay-receipts', batchId, selection: 'SHA-256 key first hex digit 0; pilot examples excluded', scope: 'First provider refund response only, not full trace or final settlement', ledgerReceipts: receipts.length, excluded, ...counts, limitation: 'Retrospective selected sandbox test-card cases, not a random merchant population or proof of production behavior.' }, null, 2));
