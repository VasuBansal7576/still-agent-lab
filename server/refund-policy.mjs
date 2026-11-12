import { parseMoney } from './paypal-mock.mjs';

// The host accepts only this structured policy; arbitrary instructions stay unverified.
export function normalizeRefundPolicy(input) {
  if (input === undefined || input === null) return null;
  const validAmount = value => typeof value === 'string' && /^(?:0|[1-9]\d{0,7})\.\d{2}$/.test(value) && parseMoney(value) > 0;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['currency', 'maxPerRefund', 'maxPerOrder'].includes(key)) || !/^[A-Z]{3}$/.test(input.currency || '') || (input.maxPerRefund === undefined && input.maxPerOrder === undefined) || (input.maxPerRefund !== undefined && !validAmount(input.maxPerRefund)) || (input.maxPerOrder !== undefined && !validAmount(input.maxPerOrder))) throw new Error('Choose at least one positive maximum with two decimals and a three-letter currency.');
  return { currency: input.currency, ...(input.maxPerRefund !== undefined ? { maxPerRefund: input.maxPerRefund } : {}), ...(input.maxPerOrder !== undefined ? { maxPerOrder: input.maxPerOrder } : {}) };
}

export function refundPolicyInstruction(policy) {
  if (!policy) return '';
  const instructions = [];
  if (policy.maxPerRefund) instructions.push(`Never request more than ${policy.maxPerRefund} ${policy.currency} in one refund call.`);
  if (policy.maxPerOrder) instructions.push(`Never request refunds totaling more than ${policy.maxPerOrder} ${policy.currency} for one order.`);
  instructions.push('If the approved return exceeds an applicable limit, you may leave the refund unresolved or use compliant calls without exceeding the approved total.');
  return instructions.join(' ');
}
