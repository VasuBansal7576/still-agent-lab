import http from 'node:http';

const server = http.createServer(async (request, response) => {
  const send = (status, value) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  if (request.method !== 'POST' || request.url !== '/agent') return send(404, { error: 'Not found.' });
  let body = '';
  try {
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 1_000_000) return send(413, { error: 'Request too large.' });
    }
    const input = JSON.parse(body);
    if (input.version !== 1 || !Array.isArray(input.messages)) return send(400, { error: 'Invalid request.' });
    const lastUser = input.messages.findLastIndex(message => message.role === 'user');
    if (lastUser < 0) return send(400, { error: 'Customer request required.' });
    const turn = input.messages.slice(lastUser + 1);
    const lastTool = turn.findLast(message => message.role === 'tool');
    if (!lastTool) return send(200, { content: 'I will check the order.', tool: { name: 'get_order', arguments: {} } });
    const result = JSON.parse(lastTool.content);
    const orderResult = turn.filter(message => message.role === 'tool').map(message => JSON.parse(message.content)).find(value => Array.isArray(value.refund_history));
    if (orderResult) {
      const customer = input.messages[lastUser].content;
      const cancellationNeeded = /cancel/i.test(customer) && orderResult.order_status === 'OPEN';
      if (cancellationNeeded && !turn.some(message => message.role === 'tool' && JSON.parse(message.content).order_status === 'CANCELED')) return send(200, { content: 'I will cancel the simulated order.', tool: { name: 'cancel_order', arguments: {} } });
      if (orderResult.refund_history.some(refund => refund.status === 'COMPLETED')) return send(200, { content: 'The payment was already refunded.', tool: null });
      if (orderResult.payment?.status !== 'COMPLETED') return send(200, { content: 'I cannot refund an unconfirmed payment.', tool: null });
      if (result.order_status === 'CANCELED' || Array.isArray(result.refund_history)) return send(200, { content: 'I will request the refund.', tool: { name: 'refund_order', arguments: { amount: orderResult.payment.amount.value, currency: orderResult.payment.amount.currency_code } } });
    }
    return send(200, { content: result.ok && result.status === 'COMPLETED' ? 'The refund is complete.' : 'I could not confirm the refund. Please contact support.', tool: null });
  } catch { return send(400, { error: 'Invalid request.' }); }
});
const port = Number(process.env.AGENT_PORT || 8787);
server.listen(port, '127.0.0.1', () => console.log(`Example agent listening at http://127.0.0.1:${port}/agent`));
