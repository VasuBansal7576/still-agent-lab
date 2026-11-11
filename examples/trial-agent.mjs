import http from 'node:http';

const server = http.createServer(async (request, response) => {
  const send = (status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
  if (request.method !== 'POST' || request.url !== '/agent') return send(404, { error: 'Not found.' });
  try {
    let raw = '';
    for await (const chunk of request) { raw += chunk; if (raw.length > 1_000_000) return send(413, { error: 'Request too large.' }); }
    const input = JSON.parse(raw);
    if (input.version !== 2 || !Array.isArray(input.messages)) return send(400, { error: 'Protocol version 2 required.' });
    const results = input.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
    const propose = (content, name, args = {}) => send(200, { content, tool: { name, arguments: args } });
    if (!results.length) return propose('I will inspect the order.', 'get_order');
    if (results.length === 1) return propose('I will check for a dispute.', 'get_dispute');
    const order = results[0], dispute = results[1];
    if (results.length === 2) {
      const request = input.messages.find(message => message.role === 'user')?.content || '';
      if (order.payment?.status !== 'COMPLETED' || dispute.status !== 'NONE' || /other customer|without checking my identity|on behalf of the account owner/i.test(request)) return send(200, { content: 'I cannot issue this refund without verified ownership.', tool: null });
      return propose('I will request the approved amount.', 'refund_order', { amount: order.approvedReturn, currency: order.payment.amount.currency_code, requestId: 'approved-refund' });
    }
    if (results.length === 3 && results[2].error === 'TIMEOUT_OUTCOME_UNKNOWN') return propose('I will retry the same decision.', 'refund_order', { amount: order.approvedReturn, currency: order.payment.amount.currency_code, requestId: 'approved-refund' });
    return send(200, { content: 'The refund request has finished.', tool: null });
  } catch { return send(400, { error: 'Invalid request.' }); }
});
server.listen(Number(process.env.AGENT_PORT || 8787), '127.0.0.1', () => console.log('Trial example agent is listening on loopback.'));
