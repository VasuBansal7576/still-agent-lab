import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBatchBinding, createMockBatchBinding } from './mcp-batch-binding.mjs';
import { createShadowSessions } from './shadow-sessions.mjs';
import { recordShadowAgent } from './shadow-agent-driver.mjs';
import { normalizeDecisionIds } from './decision-equivalence.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const encoded = value => JSON.stringify(canonical(value));
const clone = value => JSON.parse(JSON.stringify(value));
const syntheticOrder = '8AA00000BB000000C';
const syntheticCapture = '9AA00000BB000000C';

function safeCall(call, result) {
  const args = call.toolkitArguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('The recorded toolkit arguments are incomplete.');
  if (call.name === 'get_order' && (Object.keys(args).join() !== 'id' || args.id !== syntheticOrder)) throw new Error('Only the synthetic mock order can be exported.');
  if (call.name === 'list_disputes' && (Object.keys(args).join() !== 'disputed_transaction_id' || args.disputed_transaction_id !== syntheticCapture)) throw new Error('Only the synthetic mock capture can be exported.');
  if (call.name === 'create_refund' && (Object.keys(args).sort().join(',') !== 'amount,capture_id' || args.capture_id !== syntheticCapture || !args.amount || Object.keys(args.amount).sort().join(',') !== 'currency_code,value' || args.amount.currency_code !== 'USD' || !/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(args.amount.value))) throw new Error('The refund does not use the supported synthetic mock shape.');
  if (!['get_order', 'list_disputes', 'create_refund'].includes(call.name)) throw new Error('The recording includes an unsupported call.');
  if (call.decisionId && !/^[A-Za-z0-9_-]{1,127}$/.test(call.decisionId)) throw new Error('The recorded decision ID is invalid.');
  return { name: call.name, arguments: clone(args), ...(call.decisionId ? { decisionHash: hash(call.decisionId) } : {}), result: clone(result) };
}

export async function exportPortableShadow({ sourceId, store }) {
  const source = await store.get(sourceId);
  if (source.protocolVersion !== 3 || source.source !== 'local-agent' || source.agentStatus !== 'completed' || source.provenance !== 'deterministic-mock' || !source.regression?.calls?.length || source.regression.calls.length !== source.regression.expectedResults?.length) throw new Error('A completed promoted toolkit mock session is required.');
  const binding = await createBatchBinding(source.batchId, { decisionId: 'shadow-binding' });
  if (binding.protocolVersion !== 3 || hash(JSON.stringify(binding.permission)) !== source.permissionFingerprint) throw new Error('The original mock permission is no longer available.');
  const replay = await store.replay(sourceId);
  if (replay.comparison.status !== 'matched') throw new Error('Recorded calls do not reproduce their original mock outcomes.');
  const baseline = source.regression.calls.map((call, index) => safeCall(call, source.regression.expectedResults[index]));
  const payload = { version: 1, kind: 'still-portable-agent-regression', provenance: 'deterministic-mock', batchId: source.batchId, permission: clone(binding.permission), scenario: clone(source.scenario), captureId: source.captureId, baseline };
  return { payload, checksum: hash(encoded(payload)) };
}

export async function runPortableShadow({ path, endpoint }) {
  const raw = await readFile(path, 'utf8');
  if (Buffer.byteLength(raw) > 1_000_000) throw new Error('Regression artifact is too large.');
  const artifact = JSON.parse(raw);
  const p = artifact?.payload;
  if (Object.keys(artifact || {}).sort().join(',') !== 'checksum,payload' || !/^[a-f0-9]{64}$/.test(artifact.checksum || '') || hash(encoded(p)) !== artifact.checksum || p?.version !== 1 || p.kind !== 'still-portable-agent-regression' || p.provenance !== 'deterministic-mock' || !/^[0-9a-f-]{36}$/.test(p.batchId || '') || !Array.isArray(p.baseline) || !p.baseline.length || p.baseline.length > 100 || p.captureId !== syntheticCapture || p.scenario?.orderId !== syntheticOrder || p.scenario?.customerId !== 'batch-customer' || p.scenario?.kind !== 'partial-return' || p.scenario?.currency !== 'USD' || p.scenario?.disputeOpen !== false || p.scenario.amount !== p.permission?.create_refund?.maxPerOrder || p.scenario.approvedReturn !== p.scenario.amount) throw new Error('Invalid or altered mock regression artifact.');
  const permission = p.permission;
  const resolveBinding = async (batchId, { decisionId }) => {
    if (batchId !== p.batchId) throw new Error('Batch mismatch.');
    return createMockBatchBinding({ permission, agentId: permission.agentId, toolkitTrial: true, decisionId });
  };
  const directory = await mkdtemp(join(tmpdir(), 'still-regression-'));
  try {
    const store = createShadowSessions({ directory, resolveBinding });
    const session = await store.create({ source: 'local-agent', protocolVersion: 3, batchId: p.batchId });
    if (encoded(session.scenario) !== encoded(p.scenario)) throw new Error('Mock scenario mismatch.');
    const outcome = await recordShadowAgent({ endpoint, session, store });
    await store.finish(session.id, outcome.status);
    if (outcome.status !== 'completed') return { status: 'unverified', reason: outcome.reason, provenance: 'deterministic-mock' };
    const result = await store.get(session.id);
    const actual = normalizeDecisionIds(result.events.map(event => safeCall({ ...event, toolkitArguments: event.toolkitArguments }, event.result)), 'decisionHash');
    const baseline = normalizeDecisionIds(p.baseline, 'decisionHash');
    const differences = [];
    for (let i = 0; i < Math.max(baseline.length, actual.length); i++) if (encoded(baseline[i] ?? null) !== encoded(actual[i] ?? null)) differences.push(i + 1);
    return { status: differences.length ? 'changed' : 'matched', callsCompared: Math.max(baseline.length, actual.length), differences, provenance: 'deterministic-mock' };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
