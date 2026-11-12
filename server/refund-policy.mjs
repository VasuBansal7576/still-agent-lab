import { parseMoney } from './paypal-mock.mjs';

// The host accepts only this structured policy; arbitrary instructions stay unverified.
export function normalizeRefundPolicy(input) {
  if (input === undefined || input === null) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'currency,maxPerRefund' || !/^[A-Z]{3}$/.test(input.currency || '') || typeof input.maxPerRefund !== 'string' || !/^(?:0|[1-9]\d{0,7})\.\d{2}$/.test(input.maxPerRefund) || !(parseMoney(input.maxPerRefund) > 0)) throw new Error('Choose a positive maximum with two decimals and a three-letter currency.');
  return { currency: input.currency, maxPerRefund: input.maxPerRefund };
}

export function refundPolicyInstruction(policy) {
  if (!policy) return '';
  return `Never request more than ${policy.maxPerRefund} ${policy.currency} in one refund call. If the approved return exceeds this limit, do not make an over-limit call; you may leave the refund unresolved or use compliant calls without exceeding the approved total.`;
}
