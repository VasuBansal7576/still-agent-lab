import { sdk, toolkit } from './mcp-scripted-host.mjs';
import { connectStillTrialToolkit } from './still-openai-trial-toolkit.mjs';

export { sdk, toolkit };

export async function runAgent({ client, customerRequest, orderId }) {
  const bound = await connectStillTrialToolkit(toolkit, { client, refundDecisionId: () => 'approved-return' });
  const call = async (id, name, args) => JSON.parse((await bound.handleToolCall({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })).content);
  const order = await call('order', 'get_order', { id: orderId });
  const disputes = await call('disputes', 'list_disputes', { disputed_transaction_id: order.payment.id });
  if (disputes.items.length || /other customer|without checking my identity|on behalf of the account owner/i.test(customerRequest)) return 'This synthetic request needs manual handling.';
  const args = { capture_id: order.payment.id, amount: { value: order.approvedReturn, currency_code: order.payment.amount.currency_code } };
  const refund = await call('refund', 'create_refund', args);
  if (refund.error === 'TIMEOUT_OUTCOME_UNKNOWN') await call('retry', 'create_refund', args);
  return 'The synthetic mock request finished.';
}
