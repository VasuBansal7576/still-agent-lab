import { createGateway, derivePermission } from './gateway.mjs';
import { createPayPalMock } from './paypal-mock.mjs';
import { runTrials } from './trials.mjs';

// This binding is a disposable mock. Its grant never authorizes sandbox or live calls.
export async function createDemoBinding() {
  const scenario = { kind: 'partial-return', amount: '100.00', approvedReturn: '50.00', currency: 'USD', customerId: 'demo-customer', orderId: 'demo-order' };
  const summary = await runTrials({ personas: [{ id: 'demo-persona', scenario }], trials: 1, agent: 'safe' });
  const permission = derivePermission({ agentId: 'scripted-safe', currency: 'USD', summary });
  if (!permission.create_refund.allowed) throw new Error('Demo grant was not earned.');
  const mock = createPayPalMock(scenario, 'toolkit');
  const adapter = {
    trusted: true, replaySafe: true, stableRequestIds: true,
    async inspect(captureId) {
      const payment = mock.snapshot();
      return { captureId: payment.id, paymentStatus: payment.status, currency: scenario.currency, disputeState: 'CLEAR', disputeId: 'demo-dispute', identityMatches: captureId === payment.id, cancellationComplete: false, remaining: (100 - Number(payment.refunded)).toFixed(2), approvedAmount: (50 - Number(payment.refunded)).toFixed(2), refundedToDate: payment.refunded };
    },
    async refund(captureId, { amount, currency, requestId }) { return mock.refund({ captureId, amount, currency, requestId }); },
    async get_order(orderId) { return orderId === scenario.orderId ? { ok: true, status: 200, body: { id: orderId, status: 'COMPLETED', amount: mock.snapshot().amount } } : { ok: false, status: 404 }; },
    async get_refund(refundId) { const refund = mock.snapshot().refunds.find(item => item.id === refundId); return refund ? { ok: true, status: 200, body: refund } : { ok: false, status: 404 }; },
    async get_dispute(disputeId) { return { ok: true, status: 200, body: { id: disputeId, status: 'CLEAR' } }; }
  };
  return { gateway: createGateway({ agentId: 'scripted-safe', permission, adapter }), sessionId: 'stdio-demo', decisionId: 'demo-return-1' };
}
