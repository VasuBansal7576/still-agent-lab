// Convert only a fully bound v3 trace into the existing replay format.
// The original trace remains the evidence; no provider call happens here.
export function normalizeToolkitReplay(item) {
  if (!item?.toolkitProtocol) return { item };
  const deny = reason => ({ reason: `Toolkit trace is not replayable: ${reason}` });
  if (!Array.isArray(item.events)) return deny('the recorded events are missing.');
  if (item.events.some((e, i) => !Number.isSafeInteger(e.id) || e.id < 1 || (i && e.id <= item.events[i - 1].id))) return deny('the recorded event order is invalid.');
  const calls = item.events.filter(e => e.type === 'tool_call');
  if (calls.some(e => !['get_order', 'list_disputes', 'create_refund', 'get_refund'].includes(e.tool))) return deny('a tool is not supported for sandbox replay.');
  const orders = calls.filter(e => e.tool === 'get_order');
  const lists = calls.filter(e => e.tool === 'list_disputes');
  const refunds = calls.filter(e => e.tool === 'create_refund');
  const lookups = calls.filter(e => e.tool === 'get_refund');
  if (orders.length !== 1 || lists.length !== 1 || refunds.length > 2) return deny('one order lookup, one dispute listing, and at most two refunds are required.');
  const responseFor = call => {
    const results = item.events.filter(e => e.type === 'tool_result' && e.tool === call.tool && e.callId === call.id);
    return results.length === 1 ? results[0] : null;
  };
  let toolkitRefundLookup;
  if (lookups.length) {
    if (item.status !== 'pass' || refunds.length !== 1 || lookups.length !== 1) return deny('refund lookup replay requires one completed refund followed by one lookup.');
    const refund = refunds[0], lookup = lookups[0], refundResult = responseFor(refund), lookupResult = responseFor(lookup);
    const mock = refundResult?.response, observed = lookupResult?.response, mockId = mock?.body?.id;
    if (!refundResult || !lookupResult || Object.keys(lookup.arguments || {}).join(',') !== 'refund_id' || typeof mockId !== 'string' || !/^MOCK-REFUND-[A-Za-z0-9_-]+$/.test(mockId) || lookup.arguments.refund_id !== mockId || refund.id >= refundResult.id || refundResult.id >= lookup.id || lookup.id >= lookupResult.id || mock?.ok !== true || mock.status !== 201 || mock.body?.status !== 'COMPLETED' || observed?.ok !== true || observed.status !== 200 || observed.body?.id !== mockId || observed.body?.status !== 'COMPLETED' || observed.body?.amount?.value !== mock.body?.amount?.value || observed.body?.amount?.currency_code !== mock.body?.amount?.currency_code || !Array.isArray(item.finalPayment?.refunds) || item.finalPayment.refunds.length !== 1 || item.finalPayment.refunds[0]?.id !== mockId) return deny('the lookup must follow one uniquely identified completed mock refund.');
    toolkitRefundLookup = { mockRefundId: mockId, status: observed.status, outcome: observed.body.status, amount: observed.body.amount };
  }
  const orderResult = responseFor(orders[0]);
  const listResult = responseFor(lists[0]);
  const order = orderResult?.response;
  const capture = order?.payment;
  const captureId = capture?.id;
  if (!order || !captureId || captureId !== item.finalPayment?.id || orders[0].arguments?.id !== order.id || Object.keys(orders[0].arguments || {}).join(',') !== 'id' || orders[0].id >= orderResult.id) return deny('the order lookup is not bound to the recorded mock capture.');
  const listing = listResult?.response;
  if (lists[0].arguments?.disputed_transaction_id !== captureId || Object.keys(lists[0].arguments || {}).join(',') !== 'disputed_transaction_id' || lists[0].id >= listResult?.id || listing?.complete !== true || listing.provenance !== 'deterministic-mock' || !Array.isArray(listing.items) || listing.items.length > 1) return deny('a complete dispute listing for the recorded capture is required.');
  if (listing.items.some(d => d.disputed_transaction_id !== captureId || d.status !== 'OPEN' || typeof d.dispute_id !== 'string')) return deny('the mock dispute is not bound to the recorded capture.');
  const currency = capture.amount?.currency_code;
  const rewritten = new Map();
  rewritten.set(lists[0].id, { ...lists[0], tool: 'get_dispute', arguments: {} });
  rewritten.set(listResult.id, { ...listResult, tool: 'get_dispute', response: { status: listing.items.length ? 'OPEN' : 'NONE' } });
  for (const call of refunds) {
    const args = call.arguments || {};
    const amount = args.amount;
    if (orders[0].id >= call.id || orderResult.id >= call.id || lists[0].id >= call.id || listResult.id >= call.id || args.capture_id !== captureId || Object.keys(args).some(k => !['capture_id', 'amount'].includes(k))) return deny('refund targets or prior inspection do not match the recorded capture.');
    if (call.requestId !== undefined && (typeof call.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(call.requestId))) return deny('the application-supplied request ID is invalid.');
    if (amount !== undefined && (!amount || typeof amount !== 'object' || Array.isArray(amount) || Object.keys(amount).sort().join(',') !== 'currency_code,value' || typeof amount.value !== 'string' || amount.currency_code !== currency)) return deny('the refund amount or currency is unsupported.');
    if (!responseFor(call)) return deny('a refund result is missing or ambiguous.');
    rewritten.set(call.id, { ...call, toolkitNoRequestId: call.requestId === undefined, arguments: { ...(amount ? { amount: amount.value } : {}), currency, ...(call.requestId === undefined ? {} : { requestId: call.requestId }) } });
  }
  return { item: { ...item, toolkitProtocol: false, ...(toolkitRefundLookup ? { toolkitRefundLookup } : {}), events: item.events.map(event => rewritten.get(event.id) || event) } };
}
