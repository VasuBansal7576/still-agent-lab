import { recordShadowAgent } from './shadow-agent-driver.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Rerun the agent against a fresh copy of the recorded batch-bound mock. */
export async function rerunShadowAgent({ endpoint, sourceId, store }) {
  const source = await store.get(sourceId);
  if (source.protocolVersion !== 3 || source.source !== 'local-agent' || source.agentStatus !== 'completed' || !/^[a-f0-9]{64}$/.test(source.permissionFingerprint || '') || !source.regression || !Array.isArray(source.regression.calls) || !Array.isArray(source.regression.expectedResults) || !source.regression.calls.length || source.regression.calls.length !== source.regression.expectedResults.length) {
    return { status: 'unverified', reason: 'A completed promoted toolkit session with complete outcomes is required.' };
  }
  const candidate = await store.create({ source: 'local-agent', protocolVersion: 3, batchId: source.batchId });
  if (!equal(source.scenario, candidate.scenario) || source.captureId !== candidate.captureId || source.permissionFingerprint !== candidate.permissionFingerprint) {
    await store.finish(candidate.id, 'unverified');
    return { status: 'unverified', reason: 'The batch no longer produces the recorded mock scenario and permission.', sessionId: candidate.id };
  }
  const outcome = await recordShadowAgent({ endpoint, session: candidate, store });
  await store.finish(candidate.id, outcome.status);
  const recorded = await store.get(candidate.id);
  if (outcome.status !== 'completed' || !recorded.events.length) return { status: 'unverified', reason: outcome.reason || 'The agent did not complete the mock session.', sessionId: candidate.id, observed: outcome.observed };
  const calls = recorded.events.map(({ name, arguments: args, decisionId, toolkitArguments, result }) => ({ name, arguments: args, ...(decisionId ? { decisionId } : {}), ...(toolkitArguments ? { toolkitArguments } : {}), result }));
  const expected = source.regression.calls.map((call, index) => ({ ...call, result: source.regression.expectedResults[index] }));
  const differences = [];
  for (let index = 0; index < Math.max(expected.length, calls.length); index++) {
    if (!equal(expected[index], calls[index])) differences.push({ call: index + 1, expected: expected[index] ?? null, actual: calls[index] ?? null });
  }
  return { status: differences.length ? 'changed' : 'matched', sourceSessionId: sourceId, sessionId: candidate.id, batchId: source.batchId, callsCompared: Math.max(expected.length, calls.length), differences, observed: outcome.observed, finalMessage: outcome.finalMessage, provenance: 'deterministic-mock' };
}
