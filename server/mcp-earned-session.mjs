import { createMockBatchBinding } from './mcp-batch-binding.mjs';

// The host is trusted local code. Every exposed payment tool is bound to a fresh mock gateway.
export async function runMcpEarnedSession({ host, permission, policy }) {
  const { sdk, toolkit, runAgent } = host;
  const { gateway, sessionId } = createMockBatchBinding({ permission, agentId: permission.agentId, toolkitTrial: true, decisionId: 'session-binding' });
  const definitions = toolkit.getTools().map(t => ({ name: t.function?.name, description: t.function?.description || '', inputSchema: t.function?.parameters }));
  const supported = new Set(['get_order', 'get_dispute', 'list_disputes', 'get_refund', 'create_refund']);
  if (!definitions.length || definitions.some(t => !supported.has(t.name) || !t.inputSchema)) throw new Error('Unsupported host tools.');
  const server = new sdk.Server({ name: 'still-earned-mock', version: '1.0.0' }, { capabilities: { tools: {} } });
  const client = new sdk.Client({ name: 'still-earned-host', version: '1.0.0' });
  const [clientTransport, serverTransport] = sdk.InMemoryTransport.createLinkedPair();
  let active = true, calls = 0, invalid = false, serial = Promise.resolve();
  const messages = [];
  server.setRequestHandler(sdk.ListToolsRequestSchema, async () => ({ tools: definitions }));
  server.setRequestHandler(sdk.CallToolRequestSchema, request => {
    const task = serial.then(async () => {
      const { name, arguments: args, _meta } = request.params;
      const decisionId = _meta?.stillRequestId;
      if (!active || ++calls > 16 || !definitions.some(t => t.name === name) || !args || typeof args !== 'object' || Array.isArray(args) || (_meta && Object.keys(_meta).some(k => k !== 'stillRequestId')) || (decisionId !== undefined && (name !== 'create_refund' || typeof decisionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(decisionId)))) {
        invalid = true;
        return { content: [{ type: 'text', text: 'Unsupported mock call.' }], isError: true };
      }
      const gatewayArgs = name === 'get_order' && Object.keys(args).length === 1 && typeof args.id === 'string' ? { order_id: args.id } : args;
      const result = await gateway.call({ sessionId, name, arguments: gatewayArgs, decisionId });
      let output = result;
      if (name === 'get_order' && result.ok && result.body?.id === '8AA00000BB000000C') output = { id: result.body.id, approvedReturn: permission.create_refund.maxPerOrder, payment: { id: result.body.capture_id, amount: result.body.amount, status: result.body.status } };
      if (name === 'list_disputes' && result.ok) output = result.body;
      return { content: [{ type: 'text', text: JSON.stringify(output) }], ...(result.ok === false ? { isError: true } : {}) };
    }).catch(() => { invalid = true; return { content: [{ type: 'text', text: 'Mock gateway call did not complete.' }], isError: true }; });
    serial = task.then(() => undefined);
    return task;
  });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const answer = await runAgent({ client, customerRequest: `Please refund my approved USD ${permission.create_refund.maxPerOrder} return.`, orderId: '8AA00000BB000000C', policy, recordAgentMessage: text => { if (typeof text === 'string') messages.push(text.slice(0, 2000)); } });
    await serial;
    return { status: !invalid && typeof answer === 'string' && answer.trim() ? 'completed' : 'unverified', answer: typeof answer === 'string' ? answer.slice(0, 2000) : null, messages, events: gateway.events(sessionId) };
  } catch {
    await serial;
    return { status: 'unverified', answer: null, messages, events: gateway.events(sessionId) };
  } finally {
    active = false;
    await Promise.allSettled([client.close(), server.close()]);
  }
}
