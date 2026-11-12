/** Bind a toolkit-style loop to the current isolated trial client. */
export async function connectStillTrialToolkit(toolkit, { client, refundDecisionId } = {}) {
  if (typeof toolkit?.getTools !== 'function' || typeof client?.listTools !== 'function' || typeof client?.callTool !== 'function') throw new Error('A toolkit and the current trial MCP client are required.');
  if (refundDecisionId !== undefined && typeof refundDecisionId !== 'function') throw new Error('refundDecisionId must be a function.');
  const tools = toolkit.getTools();
  const remote = await client.listTools();
  const available = new Set(remote.tools.map(tool => tool.name));
  const names = new Set();
  for (const tool of tools) {
    const name = tool?.function?.name;
    if (tool?.type !== 'function' || typeof name !== 'string' || !available.has(name) || names.has(name)) throw new Error(`Still cannot bind toolkit tool: ${name ?? '(invalid definition)'}`);
    names.add(name);
  }
  return Object.freeze({
    getTools: () => tools,
    async handleToolCall(call) {
      if (call?.type !== 'function' || typeof call.id !== 'string' || !call.id || !names.has(call.function?.name)) throw new Error('Unsupported or malformed tool call.');
      let args;
      try { args = JSON.parse(call.function.arguments); } catch { throw new Error('Invalid tool call arguments.'); }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
      const name = call.function.name;
      const decisionId = name === 'create_refund' && refundDecisionId ? await refundDecisionId(call, args) : undefined;
      if (decisionId !== undefined && (typeof decisionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(decisionId))) throw new Error('Invalid refund decision ID.');
      const result = await client.callTool({ name, arguments: args, ...(decisionId ? { _meta: { stillRequestId: decisionId } } : {}) });
      if (result?.isError || result?.content?.length !== 1 || result.content[0]?.type !== 'text') throw new Error('Still mock tool call failed.');
      let value;
      try { value = JSON.parse(result.content[0].text); } catch { throw new Error('Invalid Still mock response.'); }
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.unsupported) throw new Error('Still mock tool call is unsupported.');
      if (['create_refund', 'get_refund'].includes(name) && value.ok === true) value = value.body;
      return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(value) };
    }
  });
}
