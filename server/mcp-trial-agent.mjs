import { DEFAULT_TRIAL_POLICY } from './trial-agent.mjs';

const supported = new Set(['get_order', 'get_dispute', 'list_disputes', 'get_refund', 'create_refund']);
const confirmation = { name: 'request_refund_confirmation', description: 'Ask the simulated customer to confirm the exact approved refund amount.', inputSchema: { type: 'object', properties: { amount: { type: 'string' }, currency: { type: 'string' } }, required: ['amount', 'currency'], additionalProperties: false } };

/** A fresh in-memory MCP session per trial. The host owns the agent loop. */
export function createMcpTrialAgent({ sdk, toolkit, runAgent, policy = DEFAULT_TRIAL_POLICY, maxCalls = 16 } = {}) {
  if (!sdk?.Server || !sdk?.Client || !sdk?.InMemoryTransport || !sdk?.ListToolsRequestSchema || !sdk?.CallToolRequestSchema || typeof toolkit?.getTools !== 'function' || typeof runAgent !== 'function') throw new Error('An MCP SDK, toolkit, and agent callback are required.');
  if (typeof policy !== 'string' || !policy.trim() || !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 100) throw new Error('Invalid mock trial settings.');
  const definitions = toolkit.getTools().map(t => ({ name: t.function?.name, description: t.function?.description || '', inputSchema: t.function?.parameters }));
  if (!definitions.length || definitions.some(t => !supported.has(t.name) || !t.inputSchema) || new Set(definitions.map(t => t.name)).size !== definitions.length) throw new Error('Configure only supported toolkit tools.');
  return async ({ scenario, tools, toolkitContext, recordAgentMessage }) => {
    const available = [...definitions, ...(scenario.customerFollowUp ? [confirmation] : [])];
    const server = new sdk.Server({ name: 'still-mock-trial', version: '1.0.0' }, { capabilities: { tools: {} } });
    const client = new sdk.Client({ name: 'still-trial-host', version: '1.0.0' });
    const [clientTransport, serverTransport] = sdk.InMemoryTransport.createLinkedPair();
    let active = true, calls = 0, invalid = false, serial = Promise.resolve();
    server.setRequestHandler(sdk.ListToolsRequestSchema, async () => ({ tools: available }));
    server.setRequestHandler(sdk.CallToolRequestSchema, request => {
      const operation = serial.then(async () => {
        if (!active || ++calls > maxCalls) { invalid = true; return { content: [{ type: 'text', text: 'Trial unavailable or call limit exceeded.' }], isError: true }; }
        const { name, arguments: args, _meta } = request.params;
        const decisionId = _meta?.stillRequestId;
        if (!available.some(t => t.name === name) || !args || typeof args !== 'object' || Array.isArray(args) || (decisionId !== undefined && (name !== 'create_refund' || typeof decisionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(decisionId))) || (_meta && Object.keys(_meta).some(k => k !== 'stillRequestId'))) {
          invalid = true;
          return { content: [{ type: 'text', text: 'Unsupported mock call.' }], isError: true };
        }
        const result = name === 'request_refund_confirmation' ? await tools.requestCustomerConfirmation(args) : await tools.toolkit(name, args, decisionId);
        if (result?.unsupported) invalid = true;
        return { content: [{ type: 'text', text: JSON.stringify(result) }], ...(result?.unsupported ? { isError: true } : {}) };
      }).catch(() => { invalid = true; return { content: [{ type: 'text', text: 'Mock tool call did not complete.' }], isError: true }; });
      serial = operation.then(() => undefined);
      return operation;
    });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const answer = await runAgent({ client, customerRequest: scenario.customerRequest, orderId: toolkitContext.orderId, policy, recordAgentMessage });
      await serial;
      if (invalid || typeof answer !== 'string' || !answer.trim()) return { incomplete: true, reason: 'The MCP agent did not complete the mock trial.' };
      return answer;
    } catch {
      return { incomplete: true, reason: 'The MCP agent did not complete the mock trial.' };
    } finally {
      active = false;
      await Promise.allSettled([client.close(), server.close()]);
    }
  };
}
