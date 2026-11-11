import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createSandboxEarnedGateway } from './sandbox-earned-gateway.mjs';
import { parseMoney } from './paypal-mock.mjs';

const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,127}$/.test(value);
const decimal = value => typeof value === 'string' && /^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(value) && parseMoney(value) > 0;
const syncDirectory = async path => { const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); } };

// The scenario is server-created and does not establish the actual buyer identity, return authorization, or dispute state.
export async function createSandboxScenarioGateway({ session, permission, credentials, ledgerDirectory } = {}) {
  const checkout = session?.checkout;
  if (!checkout || checkout.state !== 'captured' || checkout.replayKey || (checkout.buyerApprovalConfirmed !== true && checkout.testCardCaptureConfirmed !== true) || !session.captures?.has(checkout.captureId) || session.spent?.has(checkout.captureId) || !identifier(checkout.captureId) || !identifier(checkout.orderId) || checkout.capture?.id !== checkout.captureId || checkout.capture?.status !== 'COMPLETED' || checkout.capture?.amount?.currency_code !== 'USD' || !decimal(checkout.capture?.amount?.value) || parseMoney(checkout.capture.amount.value) < 5000) throw new Error('A fresh buyer-approved or server-attested sandbox test-card checkout with at least USD 50 is required.');
  if (permission?.scope !== 'paypal-sandbox-only' || permission.create_refund?.currency !== 'USD') throw new Error('A USD sandbox-only earned permission is required.');
  if (typeof ledgerDirectory !== 'string' || !ledgerDirectory) throw new Error('A durable reservation directory is required.');
  const captures = join(resolve(ledgerDirectory), 'captures');
  await mkdir(captures, { recursive: true, mode: 0o700 });
  const facts = Object.freeze({ provenance: 'sandbox-scenario', complete: false, captureId: checkout.captureId, orderId: checkout.orderId, customerId: `scenario-customer-${createHash('sha256').update(checkout.orderId).digest('hex').slice(0, 16)}`, currency: 'USD', disputeState: 'SYNTHETIC_CLEAR', disputeChecked: true, cancellationComplete: false, approvedRemaining: '50.00', paymentRemaining: checkout.capture.amount.value });
  const store = { async inspect() { if (session.checkout !== checkout || checkout.state !== 'captured' || session.spent.has(checkout.captureId)) return null; return facts; } };
  const reserve = async ({ captureId }) => {
    if (session.checkout !== checkout || checkout.state !== 'captured' || captureId !== checkout.captureId || session.spent.has(captureId)) return false;
    try { await mkdir(join(captures, createHash('sha256').update(captureId).digest('hex')), { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') return false; throw error; }
    await syncDirectory(captures);
    session.spent.add(captureId);
    checkout.state = 'spent';
    return true;
  };
  const gateway = createSandboxEarnedGateway({ permission, credentials, store, reserve, scenarioMode: true });
  return { facts, gateway, funding: checkout.testCardCaptureConfirmed === true ? 'paypal-sandbox-test-card' : 'paypal-sandbox-buyer-approved' };
}
