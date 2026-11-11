# Sandbox replay planning

The mock reports `COMPLETED` before any refund, `PARTIALLY_REFUNDED` after a partial refund, and `REFUNDED` after the full captured amount is refunded. A successful replay of the same refund request ID returns HTTP 200 with the original refund, while a new successful refund returns HTTP 201. These behaviors match the captured responses in [sandbox retry evidence](evidence/sandbox-retry.json). That evidence covers the observed $100 USD capture and $50 refunds, not every possible PayPal case. A refunded capture remains a paid capture for policy checks; remaining balance and duplicate-decision checks still apply.

`planSandboxReplays({ batchId, batch, maxRuns, offset, samplePasses, seed })` accepts a batch returned by `runTrials`. It schedules each failed trial once, then selects up to `samplePasses` passing trials by a seeded SHA-256 ordering. The queue is deterministic for the same batch ID, trial identities and seed. `maxRuns` is a strict bound on the `ready` slice, not a cap on the queue. The rest is marked `deferred`, including failures that exceed the bound. `queueCount`, `readyCount`, `deferredCount`, and the excluded unverified count make that backlog visible. Use `offset` to select the next slice with the same batch, seed and sample size. Maintain an external execution ledger so a slice is not executed twice, and never reuse a capture across slices. Trial identities must be unique within a batch.

`reconcileSandboxReplays({ plan, evidence, verifyReceipt })` compares supplied receipts. It sends no network requests and creates no payments. A trusted local executor must use a PayPal sandbox adapter and a fresh, human-approved capture for each replay. It must inspect and record the capture before refunding, know it has no prior refunds, and submit the same amount and currency as the mock request. Do not use production credentials or reuse a capture between trials. Pass only sanitized provider responses, never authorization headers, tokens or secrets.

Real receipts count only when the synchronous `verifyReceipt(receipt, item)` callback returns `true`. The server must implement this callback against its own protected execution ledger and compare the receipt with the recorded execution. Client-provided fields and callbacks are not proof. A missing, throwing, asynchronous, or negative verifier leaves the result unverified. An authenticated ledger exists, but there is no live replay execution endpoint or complete per-capture refund-history source wired into the app. A verifier is a trust boundary, not an independent PayPal signature. It must reject fixture adapters and untrusted attestations.

## Server integration

`executePlannedSandboxReplay({ plan, key, sessionId, checkout, adapter, ledger, getRefundHistory })` connects a server-owned replay plan, checkout and PayPal adapter to the ledger. `key` selects a ready item in the plan. The checkout must be the host's mutable session object, in `captured` state with its capture and a `buyerApprovalConfirmed` marker set only after the host observes PayPal's `APPROVED` order status. A completed capture alone is not that marker. The checkout is locked synchronously during preflight and marked spent before the ledger executes.

`getRefundHistory` is a trusted server function, never request data. It must return `{ sessionId, captureId, complete: true, exclusiveCaptureUse: true, refundedAmount: '0.00', currency, source, observedAt }` only when it has provider-backed complete history and can guarantee exclusive use through execution. The host must bind that function and adapter to the same sandbox account and keep other actors from using the capture. The current adapter cannot supply this evidence. Omit the function until a real source and exclusivity are established; the result then reports a preflight blocker and sends no refund. A browser assertion, capture status, or delayed and incomplete transaction report cannot substitute for that evidence. Never wire a fixture adapter to this live path. The server should retain the session ID, plan and checkout in server state, accept only a selected key from the browser, and pass ledger `evidence()` and `verifyReceipt` to reconciliation. The driving-test page can request preflight for a selected queued replay. The server binds its own checkout and PayPal adapter. The endpoint currently omits the unavailable trusted history callback, so no live refund is attempted.

A receipt has this shape. The `capture` and `refund` values are sanitized responses from the sandbox adapter, with `ok`, HTTP `status`, and `body`. `capture.body` contains the capture ID, status and amount. `refund.body` contains the provider response. `request` records the executed capture ID, amount, currency and request ID. The executor is responsible for the truth of its attestations. This module cannot independently authenticate a receipt.

```js
{
  key: plan.queue[0].key,
  source: 'paypal-sandbox', executor: 'trusted-local', simulated: false,
  humanApprovedFreshCapture: true, refundedBefore: '0.00',
  capture: { ok: true, status: 200, body: { id: 'SANDBOX_CAPTURE_ID', status: 'COMPLETED', amount: { value: '100.00', currency_code: 'USD' } } },
  request: { captureId: 'SANDBOX_CAPTURE_ID', amount: '50.00', currency: 'USD', requestId: 'unique-refund-decision' },
  refund: { ok: true, status: 201, body: { id: 'SANDBOX_REFUND_ID', status: 'COMPLETED', amount: { value: '50.00', currency_code: 'USD' } } }
}
```

These IDs illustrate the schema and are not evidence of a sandbox transaction. Agreement compares the HTTP status and a completed refund's amount and currency, or an identifiable 4xx provider rejection against the mock's expected success. It does not compare policies, agent decisions, disputes, timing, or complete PayPal behavior. The denominator includes only comparable authenticated real sandbox receipts. Zero comparisons yields `agreement: null`. Missing evidence, multiple or absent refund calls, timeouts, identity-changing requests, omitted amounts, server errors, and other unsupported situations remain unverified. The sandbox result contains a limited, sanitized response summary for inspection. A positive agreement is not a policy pass or proof that a mock is generally faithful.

## Simulated illustration

The following command compares a real mock run with a **simulated provider fixture**. The result is labeled `simulated-agreed` and excluded from the sandbox agreement score. It does not call PayPal.

```sh
node --input-type=module <<'JS'
import { runTrials } from './server/trials.mjs';
import { planSandboxReplays, reconcileSandboxReplays } from './server/sandbox-replay.mjs';
const batch = await runTrials({ personas: [{ id: 'example', scenario: { kind: 'return', amount: '100.00', approvedReturn: '50.00', currency: 'USD' } }], trials: 1 });
const plan = planSandboxReplays({ batchId: 'example', batch, maxRuns: 1, samplePasses: 1 });
const result = reconcileSandboxReplays({ plan, evidence: [{ key: plan.queue[0].key, source: 'simulated-provider-fixture', simulated: true, refundedBefore: '0.00', capture: { ok: true, status: 200, body: { id: 'FIXTURE_CAPTURE', status: 'COMPLETED', amount: { value: '100.00', currency_code: 'USD' } } }, request: { captureId: 'FIXTURE_CAPTURE', amount: '50.00', currency: 'USD', requestId: 'fixture-decision' }, refund: { ok: true, status: 201, body: { id: 'FIXTURE_REFUND', status: 'COMPLETED', amount: { value: '50.00', currency_code: 'USD' } } } }] });
console.log(JSON.stringify(result, null, 2));
JS
```
