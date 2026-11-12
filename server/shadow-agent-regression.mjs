import { recordShadowAgent } from './shadow-agent-driver.mjs';
import { normalizeDecisionIds } from './decision-equivalence.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function comparableShadow(value, session) {
  if (Array.isArray(value)) return value.map(item => comparableShadow(item, session));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, comparableShadow(item, session)]));
  if (session.protocolVersion !== 2 || typeof value !== 'string') return value;
  const identifiers = new Map([
    [session.scenario.orderId, '<order>'],
    [session.scenario.customerId, '<customer>'],
    [session.captureId, '<capture>'],
    [session.disputeId, '<dispute>']
  ]);
  if (identifiers.has(value)) return identifiers.get(value);
  const prefix = `MOCK-REFUND-${session.id}-`;
  if (value.startsWith(prefix) && /^[1-9][0-9]{0,2}$/.test(value.slice(prefix.length))) return `<refund-${value.slice(prefix.length)}>`;
  return value;
}

/** Rerun the agent against a fresh copy of the recorded batch-bound mock. */
export async function rerunShadowAgent({ endpoint, sourceId, store }) {
  const source = await store.get(sourceId);
  if (![2, 3].includes(source.protocolVersion) || source.source !== 'local-agent' || source.agentStatus !== 'completed' || !/^[a-f0-9]{64}$/.test(source.permissionFingerprint || '') || !source.regression || !Array.isArray(source.regression.calls) || !Array.isArray(source.regression.expectedResults) || !source.regression.calls.length || source.regression.calls.length !== source.regression.expectedResults.length) {
    return { status: 'unverified', reason: 'A completed promoted agent session with complete outcomes is required.' };
  }
  let candidate;
  try { candidate = await store.create({ source: 'local-agent', protocolVersion: source.protocolVersion, batchId: source.batchId }); }
  catch { return { status: 'unverified', reason: 'The original batch or its mock permission is unavailable or no longer qualifies.' }; }
  if (!equal(comparableShadow(source.scenario, source), comparableShadow(candidate.scenario, candidate)) || !equal(comparableShadow(source.captureId, source), comparableShadow(candidate.captureId, candidate)) || source.permissionFingerprint !== candidate.permissionFingerprint) {
    await store.finish(candidate.id, 'unverified');
    return { status: 'unverified', reason: 'The batch no longer produces the recorded mock scenario and permission.', sessionId: candidate.id };
  }
  const outcome = await recordShadowAgent({ endpoint, session: candidate, store });
  await store.finish(candidate.id, outcome.status);
  const recorded = await store.get(candidate.id);
  if (outcome.status !== 'completed' || !recorded.events.length) return { status: 'unverified', reason: outcome.reason || 'The agent did not complete the mock session.', sessionId: candidate.id, observed: outcome.observed };
  const calls = normalizeDecisionIds(comparableShadow(recorded.events.map(({ name, arguments: args, decisionId, toolkitArguments, result }) => ({ name, arguments: args, ...(decisionId ? { decisionId } : {}), ...(toolkitArguments ? { toolkitArguments } : {}), result })), recorded), 'decisionId');
  const expected = normalizeDecisionIds(comparableShadow(source.regression.calls.map((call, index) => ({ ...call, result: source.regression.expectedResults[index] })), source), 'decisionId');
  const differences = [];
  for (let index = 0; index < Math.max(expected.length, calls.length); index++) {
    if (!equal(expected[index], calls[index])) differences.push({ call: index + 1, expected: expected[index] ?? null, actual: calls[index] ?? null });
  }
  return { status: differences.length ? 'changed' : 'matched', sourceSessionId: sourceId, sessionId: candidate.id, batchId: source.batchId, callsCompared: Math.max(expected.length, calls.length), differences, observed: outcome.observed, finalMessage: outcome.finalMessage, provenance: 'deterministic-mock' };
}
