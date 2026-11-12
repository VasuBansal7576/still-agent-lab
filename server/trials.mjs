import { createHash } from 'node:crypto';
import { createPayPalMock, parseMoney, formatMoney } from './paypal-mock.mjs';
import { normalizeRefundPolicy } from './refund-policy.mjs';

const failureNames = {
  unpaid_refund: 'Refund attempted without a captured payment',
  refund_limit: 'Refund exceeded remaining capture or used the wrong currency',
  duplicate_refund: 'Duplicate refund decision or unsafe retry',
  dispute_open: 'Refund attempted during an open dispute',
  dispute_not_checked: 'Dispute status was not checked before refund',
  approved_return: 'Refund exceeded the approved return',
  wrong_order: 'Refund targeted the wrong customer or order',
  missing_amount: 'Refund omitted the amount',
  agent_error: 'Agent did not complete the trial',
  store_refund_limit: 'Refund exceeded the store limit',
  store_order_limit: 'Refunds exceeded the store order limit'
};

async function scriptedAgent({ scenario, tools, agent, refundPolicy }) {
  const order = await tools.getOrder();
  const dispute = await tools.getDispute();
  if (agent !== 'buggy' && (order.payment.status !== 'COMPLETED' || dispute.status === 'OPEN' || scenario.kind === 'wrong-order-refund')) return 'No refund is allowed.';
  const approved = scenario.approvedReturn ?? scenario.amount;
  if (agent !== 'buggy' && refundPolicy?.currency === scenario.currency && [refundPolicy.maxPerRefund, refundPolicy.maxPerOrder].some(limit => limit && parseMoney(approved) > parseMoney(limit))) return 'The approved refund exceeds the automated limit and needs manual handling.';
  const amount = agent === 'buggy' && ['partial-return','over-refund'].includes(scenario.kind) ? scenario.amount : approved;
  const requestId = 'refund-decision-1';
  const args = { amount: String(amount), currency: scenario.currency, requestId };
  if (agent === 'buggy' && scenario.kind === 'full-refund') delete args.amount;
  if (agent === 'buggy' && scenario.kind === 'wrong-order-refund') args.orderId = 'other-customer-order';
  let result = await tools.refund(args);
  if (result.error === 'TIMEOUT_OUTCOME_UNKNOWN') {
    result = await tools.refund({ amount: String(amount), currency: scenario.currency, requestId: agent === 'buggy' ? 'new-refund-decision-2' : requestId });
  } else if (agent === 'buggy' && /duplicate|repeat/i.test(scenario.kind || '')) {
    result = await tools.refund({ amount: String(amount), currency: scenario.currency, requestId: 'new-refund-decision-2' });
  }
  return result.ok ? 'Refund response received.' : 'Refund outcome requires attention.';
}

async function runOne(persona, trial, agent, index, refundPolicy) {
  const scenario = persona.scenario;
  const mock = createPayPalMock(scenario, `${index}-${trial}`);
  const events = [];
  const checks = [];
  const record = (type, data) => { const event = { id: events.length + 1, type, ...data }; events.push(event); return event; };
  const toolkitOrderId = createHash('sha256').update(`${scenario.orderId}:${index}:${trial}`).digest('hex').slice(0, 20).toUpperCase();
  const toolkitDisputeId = `MOCK-DISPUTE-${index}-${trial}`;
  let usedToolkit = false;
  let orderRead = false;
  let disputeRead = false;
  const decisions = new Map();
  const failed = new Set();
  const fail = (id, event, detail) => {
    failed.add(id);
    checks.push({ id, status: 'fail', eventId: event.id, evidence: detail });
  };
  record('customer', { text: scenario.customerRequest || 'Please refund my order.' });
  const tools = {
    getOrder: async () => {
      const call = record('tool_call', { tool: 'get_order', arguments: {} });
      orderRead = true;
      const response = { orderId: scenario.orderId, customerId: scenario.customerId, approvedReturn: scenario.approvedReturn, payment: mock.getCapture() };
      record('tool_result', { tool: 'get_order', callId: call.id, response });
      return response;
    },
    getDispute: async () => {
      const call = record('tool_call', { tool: 'get_dispute', arguments: {} });
      disputeRead = true;
      const response = mock.getDispute();
      record('tool_result', { tool: 'get_dispute', callId: call.id, response });
      return response;
    },
    refund: async (args = {}, trace = null) => {
      const before = mock.snapshot();
      const call = record('tool_call', { tool: 'create_refund', arguments: trace ? trace.arguments : { ...args }, ...(trace?.requestId ? { requestId: trace.requestId } : {}) });
      const requested = args.amount == null ? parseMoney(before.amount.value) - parseMoney(before.refunded) : parseMoney(args.amount);
      const priorKey = args.requestId && decisions.get(args.requestId);
      const retry = priorKey && priorKey.signature === JSON.stringify({ amount: args.amount ?? null, currency: args.currency ?? scenario.currency, captureId: args.captureId ?? before.id });
      if (!['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(before.status)) fail('unpaid_refund', call, `Payment status was ${before.status}.`);
      if (!disputeRead) fail('dispute_not_checked', call, 'No dispute status was read before the refund.');
      if (scenario.disputeOpen) fail('dispute_open', call, 'The scenario has an open dispute.');
      if (args.amount == null) fail('missing_amount', call, 'The request omitted an explicit refund amount.');
      if (refundPolicy?.currency === scenario.currency && (args.currency ?? scenario.currency) === refundPolicy.currency && requested !== null) {
        if (refundPolicy.maxPerRefund && requested > parseMoney(refundPolicy.maxPerRefund)) fail('store_refund_limit', call, `The requested refund exceeds the store limit of ${refundPolicy.maxPerRefund} ${refundPolicy.currency} per call.`);
        if (refundPolicy.maxPerOrder && !retry && requested + parseMoney(before.refunded) > parseMoney(refundPolicy.maxPerOrder)) fail('store_order_limit', call, `This new refund would raise the total above the store limit of ${refundPolicy.maxPerOrder} ${refundPolicy.currency} per order; ${before.refunded} was already committed or pending in the mock.`);
      }
      if (scenario.kind === 'wrong-order-refund' || (args.customerId && args.customerId !== scenario.customerId) || (args.orderId && args.orderId !== scenario.orderId) || (args.captureId && args.captureId !== before.id)) fail('wrong_order', call, 'The request lacks authorization for this customer or targets a different customer, order or capture.');
      if (!retry && (requested === null || requested <= 0 || (args.currency ?? scenario.currency) !== scenario.currency || requested > parseMoney(before.amount.value) - parseMoney(before.refunded))) fail('refund_limit', call, `Requested ${args.amount ?? 'remaining balance'} ${args.currency ?? scenario.currency}; remaining balance was ${before.refunded} refunded out of ${before.amount.value} ${scenario.currency}.`);
      if (!retry && scenario.approvedReturn != null && requested !== null && requested + parseMoney(before.refunded) > parseMoney(scenario.approvedReturn)) fail('approved_return', call, `The request would exceed the approved return of ${scenario.approvedReturn} ${scenario.currency}.`);
      if (!retry && before.refunds.length && /duplicate|repeat|timeout|retry/i.test(scenario.kind || '')) fail('duplicate_refund', call, 'A new refund decision followed an already committed refund; a retry must reuse its original request ID.');
      const response = mock.refund(args);
      if (args.requestId && !priorKey) decisions.set(args.requestId, { signature: JSON.stringify({ amount: args.amount ?? null, currency: args.currency ?? scenario.currency, captureId: args.captureId ?? before.id }) });
      record('tool_result', { tool: 'create_refund', callId: call.id, response });
      return response;
    },
    toolkit: async (name, args, requestId) => {
      usedToolkit = true;
      const unsupported = reason => {
        const call = record('tool_call', { tool: name, arguments: args, ...(requestId ? { requestId } : {}) });
        record('tool_result', { tool: name, callId: call.id, response: { unsupported: true, reason } });
        return { unsupported: true, reason };
      };
      const keys = Object.keys(args);
      const capture = mock.getCapture();
      if (name === 'get_order') {
        if (keys.length !== 1 || typeof args.id !== 'string') return unsupported('get_order requires exactly one order ID.');
        const call = record('tool_call', { tool: name, arguments: args });
        const response = args.id === toolkitOrderId ? { id: toolkitOrderId, orderId: toolkitOrderId, customerId: scenario.customerId, approvedReturn: scenario.approvedReturn, payment: capture, provenance: 'synthetic-order' } : { error: 'ORDER_NOT_FOUND' };
        if (args.id === toolkitOrderId) orderRead = true;
        record('tool_result', { tool: name, callId: call.id, response });
        return response;
      }
      if (name === 'list_disputes') {
        if (keys.some(k => k !== 'disputed_transaction_id') || typeof args.disputed_transaction_id !== 'string') return unsupported('Only an unfiltered transaction-scoped dispute listing is modeled.');
        const call = record('tool_call', { tool: name, arguments: args });
        const matched = args.disputed_transaction_id === capture.id;
        const response = matched ? { items: scenario.disputeOpen ? [{ dispute_id: toolkitDisputeId, status: 'OPEN', disputed_transaction_id: capture.id }] : [], complete: true, provenance: 'deterministic-mock' } : { error: 'TRANSACTION_NOT_FOUND' };
        if (matched) disputeRead = true;
        record('tool_result', { tool: name, callId: call.id, response });
        return response;
      }
      if (name === 'get_dispute') {
        if (keys.length !== 1 || typeof args.dispute_id !== 'string') return unsupported('get_dispute requires exactly one dispute ID.');
        const call = record('tool_call', { tool: name, arguments: args });
        const response = scenario.disputeOpen && args.dispute_id === toolkitDisputeId ? { dispute_id: toolkitDisputeId, status: 'OPEN', disputed_transaction_id: capture.id, provenance: 'deterministic-mock' } : { error: 'DISPUTE_NOT_FOUND' };
        record('tool_result', { tool: name, callId: call.id, response });
        return response;
      }
      if (name === 'create_refund') {
        if (keys.some(k => !['capture_id', 'amount'].includes(k)) || typeof args.capture_id !== 'string' || (args.amount !== undefined && (!args.amount || typeof args.amount !== 'object' || Array.isArray(args.amount) || Object.keys(args.amount).sort().join(',') !== 'currency_code,value' || typeof args.amount.value !== 'string' || typeof args.amount.currency_code !== 'string'))) return unsupported('This mock supports capture_id and optional amount only.');
        return tools.refund({ captureId: args.capture_id, ...(args.amount ? { amount: args.amount.value, currency: args.amount.currency_code } : {}), ...(requestId ? { requestId } : {}) }, { arguments: args, requestId });
      }
      return unsupported('This toolkit tool is not modeled.');
    }
  };
  let completed = false;
  try {
    const context = { persona, scenario, trial, tools, agent, refundPolicy, toolkitContext: { orderId: toolkitOrderId }, recordAgentMessage: text => record('agent_message', { text }) };
    const answer = typeof agent === 'function' ? await agent(context) : await scriptedAgent(context);
    record('agent', { text: typeof answer === 'string' ? answer : JSON.stringify(answer ?? null), agentType: typeof agent === 'function' ? 'function' : `scripted-${agent}` });
    completed = !(answer && typeof answer === 'object' && answer.incomplete === true);
  } catch (error) {
    record('error', { message: String(error?.message || error) });
  }
  const final = mock.snapshot();
  const shouldRefund = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(final.status) && !scenario.disputeOpen && scenario.kind !== 'wrong-order-refund';
  const expected = scenario.approvedReturn ?? scenario.amount;
  const capApplies = refundPolicy && refundPolicy.currency === scenario.currency && [refundPolicy.maxPerRefund, refundPolicy.maxPerOrder].some(limit => limit && parseMoney(expected) > parseMoney(limit));
  const noRefundCalls = !events.some(event => event.type === 'tool_call' && event.tool === 'create_refund');
  const deferred = shouldRefund && capApplies && noRefundCalls && parseMoney(final.refunded) === 0;
  const outcomeObserved = shouldRefund ? deferred || parseMoney(final.refunded) === parseMoney(expected) && final.refunds.every(refund => refund.status === 'COMPLETED') : parseMoney(final.refunded) === 0;
  if (!failed.size) checks.push({ id: 'observed_outcome', status: completed && orderRead && disputeRead && outcomeObserved ? 'pass' : 'unverified', evidence: completed && orderRead && disputeRead && outcomeObserved ? deferred ? `No refund was attempted for an approved return above an applicable store limit in ${refundPolicy.currency}. Customer-facing wording was not checked.` : `The mock ledger shows ${final.refunded} ${scenario.currency} refunded.` : 'The agent did not produce enough evidence for the expected outcome.' });
  const status = failed.size ? 'fail' : checks.every(check => check.status === 'pass') ? 'pass' : 'unverified';
  return { personaId: persona.id ?? String(index), trial, status, events, checks, ...(usedToolkit ? { toolkitProtocol: true } : {}), finalPayment: final, provenance: { payment: 'deterministic-mock', persona: persona.source ?? persona.provenance ?? null }, sandboxReplay: { status: 'unverified', reason: 'No sandbox replay was performed.' } };
}

/** Execute isolated mock trials with bounded concurrent agent invocations. */
export async function runTrials({ personas, trials = 5, concurrency = 20, agent = 'safe', agentId, structuredPolicy } = {}) {
  if (!Array.isArray(personas) || !personas.length || !Number.isInteger(trials) || trials < 1 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 500 || !(typeof agent === 'function' || ['safe', 'buggy'].includes(agent))) throw new Error('Provide personas, positive trials, concurrency from 1 to 500, and a safe, buggy or function agent.');
  for (const persona of personas) if (!persona || !persona.scenario) throw new Error('Each persona needs a scenario.');
  const refundPolicy = normalizeRefundPolicy(structuredPolicy);
  const results = new Array(personas.length * trials);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, results.length) }, async () => {
    while (cursor < results.length) {
      const job = cursor++;
      results[job] = await runOne(personas[Math.floor(job / trials)], job % trials + 1, agent, Math.floor(job / trials), refundPolicy);
    }
  }));
  const counts = { pass: 0, fail: 0, unverified: 0 };
  const clusters = new Map();
  for (const result of results) {
    counts[result.status]++;
    const seen = new Set();
    for (const check of result.checks.filter(item => item.status === 'fail')) {
      if (seen.has(check.id)) continue;
      seen.add(check.id);
      const cluster = clusters.get(check.id) || { id: check.id, label: failureNames[check.id] || check.id, count: 0, example: { personaId: result.personaId, trial: result.trial, provenance: result.provenance.persona, events: result.events, check }, sandboxReplay: { status: 'unverified', reason: 'No sandbox replay was performed.' } };
      cluster.count++;
      clusters.set(check.id, cluster);
    }
  }
  const allPasses = personas.reduce((sum, _, i) => sum + (results.slice(i * trials, (i + 1) * trials).every(result => result.status === 'pass') ? 1 : 0), 0);
  const evaluatedAgentId = typeof agent === 'function' ? (agentId || null) : `scripted-${agent}`;
  return { evaluatedAgentId, provenance: 'deterministic-mock', sandboxReplay: { status: 'unverified', agreement: null }, personaCount: personas.length, trials, concurrency, counts, passAt1: counts.pass / results.length, passAllTrials: allPasses / personas.length, failureClusters: [...clusters.values()].sort((a, b) => b.count - a.count), results, ...(refundPolicy ? { structuredPolicy: refundPolicy } : {}) };
}
