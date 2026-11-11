/** Bind toolkit OpenAI definitions to an already connected Still MCP client. */
export async function createStillToolkitAdapter({ toolkit, client }) {
  const tools = toolkit.getTools();
  const remote = await client.listTools();
  const available = new Set(remote.tools.map(tool => tool.name));
  const names = new Set();
  for (const tool of tools) {
    const name = tool?.function?.name;
    if (tool?.type !== 'function' || typeof name !== 'string' || !available.has(name) || names.has(name)) {
      throw new Error(`Still cannot bind toolkit tool: ${name ?? '(invalid definition)'}`);
    }
    names.add(name);
  }
  return {
    tools,
    async dispatch(toolCalls) {
      if (!Array.isArray(toolCalls)) throw new Error('Expected an array of OpenAI tool calls.');
      const parsed = toolCalls.map(call => {
        if (call?.type !== 'function' || typeof call.id !== 'string' || !call.id || !names.has(call.function?.name)) {
          throw new Error('Unsupported or malformed tool call.');
        }
        let args;
        try { args = JSON.parse(call.function.arguments); } catch { throw new Error('Invalid tool call arguments.'); }
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
        return { id: call.id, name: call.function.name, arguments: args };
      });
      const ids = new Set(parsed.map(call => call.id));
      if (ids.size !== parsed.length) throw new Error('Duplicate tool call IDs.');
      const messages = [];
      // Calls are serialized because a decision may depend on an earlier inspection.
      for (const call of parsed) {
        const result = await client.callTool({ name: call.name, arguments: call.arguments });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
      return messages;
    }
  };
}
