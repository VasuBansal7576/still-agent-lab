export const cancellationScenario = Object.freeze({
  id: 'duplicate-cancellation',
  title: 'Cancellation and duplicate refund request',
  amount: '50.00',
  currency: 'USD',
  customerRequests: Object.freeze([
    'Please cancel my order and refund the $50 I paid.',
    'I am following up on the same order. Please cancel it and refund my $50.'
  ]),
  defaultPolicy: 'Refund only captured payments. Never refund more than the captured payment. Never refund an already completed cancellation again.',
  provenance: 'Hand-authored scenario. It is not a τ-bench task or a UCI Online Retail basket.'
});
