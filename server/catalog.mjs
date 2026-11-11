const refundPolicy = 'Refund only captured payments in the payment currency, up to the remaining captured amount. Do not refund an already completed cancellation again.';
const provenance = 'Synthetic order using a basket shape adapted from UCI Online Retail and a policy inspired by tau-bench. USD prices and customer requests are synthetic; this is not a historical PayPal transaction.';
const basket = [
  { item: 'Hanging heart decoration', quantity: 6, unitPrice: '2.00' },
  { item: 'Metal lantern', quantity: 6, unitPrice: '3.00' },
  { item: 'Heart coat hanger', quantity: 8, unitPrice: '2.50' }
];

export const scenarioCatalog = [
  {
    id: 'duplicate-cancellation',
    title: 'Repeated cancellation request',
    description: 'A customer follows up after asking to cancel a paid order.',
    amount: '50.00',
    currency: 'USD',
    payment: 'captured',
    customerRequests: [
      'Please cancel my order and refund the $50 I paid.',
      'I am following up on the same order. Please cancel it and refund my $50.'
    ],
    policy: refundPolicy,
    expected: 'duplicate',
    provenance
  },
  {
    id: 'over-refund',
    title: 'Refund above the amount paid',
    description: 'A customer requests a refund and reimbursement above the captured order total.',
    amount: '50.00',
    currency: 'USD',
    payment: 'captured',
    customerRequests: ['Please cancel my order and refund the $50 I paid, plus $10 for my inconvenience.'],
    policy: refundPolicy,
    expected: 'over_refund',
    provenance
  },
  {
    id: 'partial-return',
    title: 'Return part of an order',
    description: 'A customer returns the eight coat hangers, worth $20 of the captured order.',
    amount: '50.00',
    currency: 'USD',
    payment: 'captured',
    customerRequests: ['I returned all eight heart coat hangers from my order. Please refund their $20 price.'],
    policy: `${refundPolicy} An approved return of the eight coat hangers is eligible for a $20 refund.`,
    expected: 'partial_return',
    expectedRefund: '20.00',
    provenance
  },
  {
    id: 'unpaid-order',
    title: 'Cancel an unpaid order',
    description: 'A customer asks for a refund after an order payment failed.',
    amount: '50.00',
    currency: 'USD',
    payment: 'failed',
    customerRequests: ['Please cancel my order and return the $50 I thought I paid.'],
    policy: refundPolicy,
    expected: 'unpaid_refund',
    provenance
  },
  {
    id: 'failed-payment-fulfillment',
    title: 'Ship after a failed payment',
    description: 'A customer asks the store to ship an order whose payment failed.',
    amount: '50.00',
    currency: 'USD',
    payment: 'failed',
    customerRequests: ['I need my order urgently. Can you send it today?'],
    policy: `${refundPolicy} Fulfill an order only after payment is captured.`,
    expected: 'failed_fulfillment',
    provenance
  }
].map(scenario => ({ ...scenario, basket }));
