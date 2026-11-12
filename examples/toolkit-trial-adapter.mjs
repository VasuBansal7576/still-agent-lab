import http from 'node:http';

const supported = new Set(['get_order', 'list_disputes', 'get_dispute', 'get_refund', 'create_refund']);

// `decide` receives Still's full conversation and the selected toolkit definitions.
// It returns one OpenAI-shaped assistant message and optional application request ID.
export function createToolkitTrialServer({ toolkit, decide }) {
  if (!toolkit || typeof toolkit.getTools !== 'function' || typeof decide !== 'function') throw new Error('A toolkit and decision callback are required.');
  const definitions = toolkit.getTools();
  if (!Array.isArray(definitions) || !definitions.length || definitions.some(tool => tool?.type !== 'function' || !supported.has(tool.function?.name))) throw new Error('Configure only Still-supported toolkit tools.');
  const names = new Set(definitions.map(tool => tool.function.name));
  if (names.size !== definitions.length) throw new Error('Duplicate toolkit tool definitions.');
  return http.createServer(async (request, response) => {
    const send = (status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.method !== 'POST' || request.url !== '/agent') return send(404, { error: 'Not found.' });
    try {
      let raw = '';
      for await (const chunk of request) { raw += chunk; if (Buffer.byteLength(raw) > 1_000_000) return send(413, { error: 'Request too large.' }); }
      const input = JSON.parse(raw);
      if (input.version !== 3 || !Array.isArray(input.messages) || !Array.isArray(input.tools) || [...names].some(name => !input.tools.includes(name))) return send(400, { error: 'Incompatible trial request.' });
      const confirmationAvailable = input.tools.includes('request_refund_confirmation');
      const applicationTools = confirmationAvailable ? [{ type: 'function', function: { name: 'request_refund_confirmation', description: 'Ask the synthetic customer to confirm the exact approved refund amount and currency.', parameters: { type: 'object', properties: { amount: { type: 'string', pattern: '^(?:0|[1-9][0-9]{0,5})\\.[0-9]{2}$' }, currency: { type: 'string', pattern: '^[A-Z]{3}$' } }, required: ['amount', 'currency'], additionalProperties: false } } }] : [];
      const decision = await decide({ messages: input.messages, tools: definitions, applicationTools });
      const message = decision?.message;
      if (!message || typeof message !== 'object' || (message.content !== null && typeof message.content !== 'string')) throw new Error('Invalid assistant message.');
      const calls = message.tool_calls ?? [];
      if (!Array.isArray(calls) || calls.length > 1) throw new Error('Exactly one tool call per turn is supported.');
      if (!calls.length) {
        if (typeof message.content !== 'string' || !message.content.trim() || decision.requestId !== undefined) throw new Error('Invalid final response.');
        return send(200, { content: message.content, tool: null });
      }
      const call = calls[0];
      if (call.type !== 'function' || !(names.has(call.function?.name) || (confirmationAvailable && call.function?.name === 'request_refund_confirmation')) || typeof call.function.arguments !== 'string') throw new Error('Unsupported tool call.');
      const args = JSON.parse(call.function.arguments);
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments.');
      if (decision.requestId !== undefined && call.function.name !== 'create_refund') throw new Error('Request ID on a non-refund call.');
      if (decision.requestId !== undefined && (typeof decision.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(decision.requestId))) throw new Error('Invalid request ID format.');
      return send(200, { content: message.content || '', tool: { name: call.function.name, arguments: args, ...(decision.requestId !== undefined ? { requestId: decision.requestId } : {}) } });
    } catch (error) {
      const known = new Set(['Model request failed.', 'Model response invalid.', 'Invalid assistant message.', 'Exactly one tool call per turn is supported.', 'Invalid final response.', 'Unsupported tool call.', 'Invalid tool arguments.', 'Request ID on a non-refund call.', 'Invalid request ID format.']);
      console.error(known.has(error?.message) ? error.message : 'Agent decision failed or was unsupported.');
      return send(502, { error: 'Agent decision failed or was unsupported.' });
    }
  });
}
