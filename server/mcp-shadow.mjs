import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockBatchBinding } from './mcp-batch-binding.mjs';
import { runMcpEarnedSession } from './mcp-earned-session.mjs';
import { normalizeDecisionIds } from './decision-equivalence.mjs';

const directory = fileURLToPath(new URL('../.data/mcp-shadow/', import.meta.url));
const validId = id => typeof id === 'string' && /^mcp-shadow-[a-f0-9-]{36}$/.test(id);
const callsFrom = events => events.map(({ name, arguments: args, decisionId }) => ({ name, arguments: args, ...(decisionId ? { decisionId } : {}) }));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const comparison = (expected, actual) => {
  if (!Array.isArray(expected) || !expected.length || !Array.isArray(actual)) return { status: 'unverified', reason: 'Recorded outcomes are incomplete.' };
  const differences = Array.from({ length: Math.max(expected.length, actual.length) }, (_, i) => JSON.stringify(canonical(expected[i])) === JSON.stringify(canonical(actual[i])) ? null : { call: i + 1, expected: expected[i] ?? null, actual: actual[i] ?? null }).filter(Boolean);
  return { status: differences.length ? 'changed' : 'matched', callsCompared: Math.max(expected.length, actual.length), differences };
};

export async function createMcpShadow({ batchId, host, permission, policy, hostMatches }) {
  const id = `mcp-shadow-${randomUUID()}`;
  const outcome = await runMcpEarnedSession({ host, permission, policy });
  if (!await hostMatches()) throw new Error('The configured MCP host changed during recording.');
  const status = outcome.status === 'completed' && outcome.events.length ? 'completed' : 'unverified';
  const record = { version: 1, id, batchId, provenance: 'deterministic-mock', createdAt: new Date().toISOString(), status, events: outcome.events, answer: outcome.answer, regression: null };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, `${id}.json`), JSON.stringify(record), { mode: 0o600, flag: 'wx' });
  return record;
}

export async function readMcpShadow(id) {
  if (!validId(id)) throw new Error('Invalid MCP shadow session.');
  const record = JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8'));
  if (record.id !== id || record.version !== 1 || record.provenance !== 'deterministic-mock') throw new Error('Invalid MCP shadow record.');
  return record;
}

export async function promoteMcpShadow(record, permission) {
  if (record.status !== 'completed' || !Array.isArray(record.events) || !record.events.length) throw new Error('Complete an MCP session before promotion.');
  const regression = { version: 1, kind: 'gateway-regression', sourceSessionId: record.id, calls: callsFrom(record.events), expectedResults: record.events.map(event => event.result) };
  const { gateway } = createMockBatchBinding({ permission, agentId: permission.agentId, toolkitTrial: true, decisionId: 'session-binding' });
  const replay = await gateway.replay(regression);
  const result = comparison(regression.expectedResults, replay.results);
  record.regression = regression;
  const target = join(directory, `${record.id}.json`), temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
  await rename(temporary, target);
  return { regression, replay, comparison: result };
}

export async function rerunMcpShadow(record, { host, permission, policy, hostMatches }) {
  if (!record.regression || record.status !== 'completed') throw new Error('Promote a completed MCP session first.');
  const outcome = await runMcpEarnedSession({ host, permission, policy });
  if (!await hostMatches() || outcome.status !== 'completed' || !outcome.events.length) return { status: 'unverified', reason: 'The host changed or the agent session did not complete.', outcome };
  const expected = record.events.map(({ name, arguments: args, decisionId, result }) => ({ name, arguments: args, ...(decisionId ? { decisionId } : {}), result }));
  const actual = outcome.events.map(({ name, arguments: args, decisionId, result }) => ({ name, arguments: args, ...(decisionId ? { decisionId } : {}), result }));
  return { ...comparison(normalizeDecisionIds(expected, 'decisionId'), normalizeDecisionIds(actual, 'decisionId')), outcome };
}
