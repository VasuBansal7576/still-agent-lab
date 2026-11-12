import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGateway, derivePermission } from './gateway.mjs';
import { createPayPalMock } from './paypal-mock.mjs';
import { runTrials } from './trials.mjs';

const MAX_SESSIONS = 200;
const MAX_CALLS = 100;
const validId = value => typeof value === 'string' && /^shadow-[a-f0-9-]{36}$/.test(value);
const sourceValues = new Set(['demo', 'local-agent']);
const money = value => typeof value === 'string' && /^(?:0|[1-9]\d{0,5})\.\d{2}$/.test(value) && Number(value) > 0;

async function binding(record) {
  const { scenario, id } = record;
  const summary = await runTrials({ personas: [{ id: 'shadow-permission', scenario }], trials: 1, agent: 'safe' });
  const permission = derivePermission({ agentId: 'scripted-safe', currency: scenario.currency, summary });
  const mock = createPayPalMock(scenario, id);
  const adapter = {
    trusted: true, replaySafe: true, stableRequestIds: true,
    async inspect(captureId) {
      const payment = mock.snapshot();
      return { captureId: payment.id, paymentStatus: payment.status, currency: scenario.currency, disputeState: scenario.disputeOpen ? 'OPEN' : 'CLEAR', disputeId: record.disputeId, identityMatches: captureId === payment.id, cancellationComplete: false, remaining: (Number(scenario.amount) - Number(payment.refunded)).toFixed(2), approvedAmount: Math.max(0, Number(scenario.approvedReturn) - Number(payment.refunded)).toFixed(2), refundedToDate: payment.refunded };
    },
    async refund(captureId, { amount, currency, requestId }) { return mock.refund({ captureId, amount, currency, requestId }); },
    async get_order(orderId) { return { ok: true, status: 200, body: { id: orderId, status: 'COMPLETED', amount: mock.snapshot().amount } }; },
    async get_refund(refundId) { const refund = mock.snapshot().refunds.find(item => item.id === refundId); return refund ? { ok: true, status: 200, body: refund } : { ok: false, status: 404 }; },
    async get_dispute(disputeId) { return { ok: true, status: 200, body: { id: disputeId, status: scenario.disputeOpen ? 'OPEN' : 'CLEAR' } }; }
  };
  return createGateway({ agentId: 'scripted-safe', permission, adapter, mode: 'shadow' });
}

function validateCall(record, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['name', 'arguments', 'decisionId'].includes(key))) throw new Error('Invalid tool call.');
  const args = input.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
  const ids = { get_order: ['order_id', record.scenario.orderId], get_dispute: ['dispute_id', record.disputeId] };
  if (ids[input.name]) {
    const [key, expected] = ids[input.name];
    if (Object.keys(args).length !== 1 || args[key] !== expected || input.decisionId !== undefined) throw new Error('Unknown mock identifier or invalid arguments.');
    return { name: input.name, arguments: { [key]: expected } };
  }
  if (input.name === 'get_refund') {
    if (Object.keys(args).length !== 1 || typeof args.refund_id !== 'string' || !new RegExp(`^MOCK-REFUND-${record.id}-[1-9][0-9]{0,2}$`).test(args.refund_id) || input.decisionId !== undefined) throw new Error('Unknown mock refund identifier or invalid arguments.');
    return { name: input.name, arguments: { refund_id: args.refund_id } };
  }
  if (input.name !== 'create_refund' || Object.keys(args).some(k => !['capture_id', 'amount'].includes(k)) || args.capture_id !== record.captureId || !args.amount || Object.keys(args.amount).some(k => !['value', 'currency_code'].includes(k)) || !money(args.amount.value) || !/^[A-Z]{3}$/.test(args.amount.currency_code || '') || typeof input.decisionId !== 'string' || input.decisionId.length < 1 || input.decisionId.length > 256) throw new Error('Refund requires the mock capture, explicit amount, currency and decision ID.');
  const decisionId = `decision-${createHash('sha256').update(input.decisionId).digest('hex')}`;
  return { name: input.name, arguments: { capture_id: args.capture_id, amount: { value: args.amount.value, currency_code: args.amount.currency_code } }, decisionId };
}

/** Records only constrained calls to an isolated mock. The directory is private local data. */
export function createShadowSessions({ directory } = {}) {
  if (typeof directory !== 'string' || !directory) throw new Error('A storage directory is required.');
  let queue = Promise.resolve();
  const gateways = new Map();
  const serial = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  const path = id => { if (!validId(id)) throw new Error('Invalid shadow session ID.'); return join(directory, `${id}.json`); };
  const save = async record => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.${record.id}-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(record, null, 2), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path(record.id));
  };
  const get = async id => {
    const record = JSON.parse(await readFile(path(id), 'utf8'));
    if (record.version !== 1 || record.id !== id || !Array.isArray(record.events) || record.events.length > MAX_CALLS) throw new Error('Invalid stored session.');
    return record;
  };
  async function restored(record) {
    if (gateways.has(record.id)) return gateways.get(record.id);
    const gateway = await binding(record);
    for (const event of record.events) await gateway.call({ sessionId: record.id, name: event.name, arguments: event.arguments, ...(event.decisionId ? { decisionId: event.decisionId } : {}) });
    gateways.set(record.id, gateway);
    return gateway;
  }
  async function list() {
    let names;
    try { names = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const records = [];
    for (const name of names.filter(name => /^shadow-[a-f0-9-]{36}\.json$/.test(name)).slice(0, MAX_SESSIONS)) records.push(await get(name.slice(0, -5)));
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  function create({ source, amount = '100.00', approvedReturn = '50.00', currency = 'USD', disputeOpen = false } = {}) {
    return serial(async () => {
      if (!sourceValues.has(source) || !money(amount) || !money(approvedReturn) || Number(approvedReturn) > Number(amount) || !/^[A-Z]{3}$/.test(currency) || typeof disputeOpen !== 'boolean') throw new Error('Invalid mock session configuration.');
      if ((await list()).length >= MAX_SESSIONS) throw new Error('Shadow session limit reached.');
      const id = `shadow-${randomUUID()}`;
      const scenario = { kind: 'partial-return', amount, approvedReturn, currency, disputeOpen, customerId: `MOCK-CUSTOMER-${id}`, orderId: `MOCK-ORDER-${id}` };
      const record = { version: 1, id, source, provenance: 'deterministic-mock', createdAt: new Date().toISOString(), scenario, captureId: `MOCK-CAPTURE-${id}`, disputeId: `MOCK-DISPUTE-${id}`, events: [], regression: null };
      await save(record);
      return record;
    });
  }
  function call(id, input) {
    return serial(async () => {
      const record = await get(id);
      if (record.events.length >= MAX_CALLS) throw new Error('Shadow call limit reached.');
      const safeCall = validateCall(record, input);
      const gateway = await restored(record);
      const result = await gateway.call({ sessionId: id, ...safeCall });
      record.events = gateway.events(id).map(event => structuredClone(event));
      try { await save(record); } catch (error) { gateways.delete(id); throw error; }
      return { result, session: record };
    });
  }
  function promote(id) {
    return serial(async () => {
      const record = await get(id);
      if (!record.events.length) throw new Error('Cannot promote an empty session.');
      record.regression = { version: 1, kind: 'gateway-regression', sourceSessionId: id, source: record.source, provenance: 'deterministic-mock', promotedAt: new Date().toISOString(), calls: record.events.map(({ name, arguments: args, decisionId }) => ({ name, arguments: args, ...(decisionId ? { decisionId } : {}) })), expectedResults: record.events.map(event => event.result) };
      await save(record);
      return record.regression;
    });
  }
  function replay(id) {
    return serial(async () => {
      const record = await get(id);
      if (!record.regression) throw new Error('Promote the session before replay.');
      const gateway = await binding(record);
      const replay = await gateway.replay(record.regression);
      const expected = record.regression.expectedResults;
      let comparison;
      if (!Array.isArray(expected) || expected.length !== replay.results.length || expected.some(result => !result || typeof result !== 'object')) {
        comparison = { status: 'unverified', reason: 'The saved regression has no complete recorded outcomes.' };
      } else {
        const differences = replay.results.flatMap((actual, index) => JSON.stringify(actual) === JSON.stringify(expected[index]) ? [] : [{ call: index + 1, name: record.regression.calls[index].name, expected: expected[index], actual }]);
        comparison = { status: differences.length ? 'changed' : 'matched', callsCompared: expected.length, differences };
      }
      return { provenance: 'deterministic-mock', sourceSessionId: id, ...replay, events: gateway.events(replay.sessionId), comparison };
    });
  }
  return { create, call, get, list, promote, replay };
}
