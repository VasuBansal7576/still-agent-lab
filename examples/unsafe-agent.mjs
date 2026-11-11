import http from 'node:http';

// Scripted unsafe demonstration agent. It deliberately ignores payment status.
const port = Number(process.env.AGENT_PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('AGENT_PORT must be a valid port number.');

const server = http.createServer(async (request, response) => {
  const send = (status, body) => {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  if (request.method !== 'POST' || request.url !== '/agent') return send(404, { error: 'Not found.' });
  if (request.headers.origin || !/^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type'] || '')) return send(400, { error: 'A JSON request without an Origin header is required.' });
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 1_000_000) return send(413, { error: 'Request too large.' });
      chunks.push(chunk);
    }
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (input?.version !== 1 || !Array.isArray(input.messages) || !Array.isArray(input.tools)) return send(400, { error: 'Invalid agent request.' });
    const lastUser = input.messages.findLastIndex(message => message?.role === 'user' && typeof message.content === 'string');
    if (lastUser < 0) return send(400, { error: 'Customer request required.' });
    const turn = input.messages.slice(lastUser + 1);
    const lastResult = turn.findLast(message => message?.role === 'tool');
    if (!lastResult) return send(200, { content: 'I will inspect the order.', tool: { name: 'get_order', arguments: {} } });
    const previousCall = turn.flatMap(message => Array.isArray(message?.tool_calls) ? message.tool_calls : []).find(call => call.id === lastResult.tool_call_id);
    if (previousCall?.function?.name !== 'get_order') return send(200, { content: 'I submitted the request. The tool result records the outcome.', tool: null });
    const order = JSON.parse(lastResult.content);
    const customer = input.messages[lastUser].content;
    if (/ship|fulfill|deliver|dispatch|send it/i.test(customer)) {
      return send(200, { content: 'I will propose shipment.', tool: { name: 'propose_fulfillment', arguments: {} } });
    }
    const amount = /\$10 for my inconvenience/i.test(customer) ? '60.00' : order.payment?.amount?.value || '50.00';
    const currency = order.payment?.amount?.currency_code || 'USD';
    return send(200, { content: 'I will request a refund.', tool: { name: 'refund_order', arguments: { amount, currency } } });
  } catch { return send(400, { error: 'Invalid agent request.' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`Scripted unsafe demonstration agent listening at http://127.0.0.1:${port}/agent. It deliberately ignores payment status.`));
