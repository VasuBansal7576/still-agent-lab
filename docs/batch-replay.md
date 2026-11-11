# Bulk sandbox replays

`server/batch-replay-runner.mjs` replays supported trials from a saved mock batch using fresh PayPal sandbox test-card captures. It connects only to `api-m.sandbox.paypal.com`. The card number is a public PayPal test number. It does not use a real card or move real money.

From the project directory, start a batch with a maximum number of new attempts and at most eight workers:

```sh
node server/batch-replay-runner.mjs BATCH-UUID 5000 8
```

The runner requires the connected sandbox credentials in macOS Keychain. It skips trials that already have ledger receipts. It writes a private claim before creating each order and records the order request ID and the provider capture ID when known. A claim is never automatically retried after a process interruption or an uncertain outcome. Reconcile that claim before taking any further action. A capture and replay key are reserved once in the existing replay ledger. Credentials, access tokens and test card values are not written to claims or output.

Progress and the final summary distinguish actual sandbox comparisons from skipped, unsupported and unverified trials. The runner stops scheduling more work on authentication, rate-limit or server errors or an uncertain provider operation. In-flight workers may finish after the stop. Disagreements are preserved as results and do not stop the batch. It does not automatically resolve claimed but unverified trials. The deterministic timeout in a mock trace remains an injected condition; it is not evidence of an actual network timeout.

For open-dispute trials, the runner requests a simulated **card chargeback**, not a PayPal wallet inquiry. The distinction matters: the sandbox can refuse a refund during a card chargeback even when the mock predicts it will succeed. It verifies an unresolved dispute is linked to the exact capture before a refund. An accepted chargeback can take longer to appear in PayPal's listing; if the ID cannot be confirmed within the bounded wait, the claim stays unverified and is not retried.

To inspect a delayed claim without creating another chargeback or sending a refund, run `node server/batch-replay-reconcile.mjs CAPTURE-ID`. The script uses the documented transaction filter and retrieves the unique dispute detail. It reports `linked-open` only if PayPal identifies the exact capture and an unresolved dispute. Keep ambiguous, missing or resolved claims unverified. This command does not resume the refund.

To resume verified delayed claims, use `node server/batch-replay-runner.mjs BATCH-UUID 1 1 resume-chargebacks`. It checks the link and unresolved state again, creates a durable one-use resume claim, and asks the existing replay ledger to reserve the refund. Unknown results are never retried automatically. It does not resume an order request without a confirmed capture or a claim already executed. Reports with only a sample or only supported cases do not establish agreement for the entire batch.

On November 11, 2026, one pilot used batch `40f79126-1d0a-4152-b23d-5ef9c221e7ce` and persona `persona-0005eaa92f659196361b`, trial 1. PayPal returned a completed capture `2N920151M6514771T` and a completed GBP 442.14 refund `9YY90559UH828054J`. The authenticated replay ledger comparison agreed. This pilot does not verify the remaining failures.

In a subsequent bulk run, PayPal returned some HTTP 201 refunds with `PENDING` status and an HTTP 422 `REFUND_NOT_ALLOWED` for a capture that still showed `COMPLETED`. PayPal re-reads of two pending refunds reported status reason `ECHECK`. The cause of the rejection is unknown. Pending refunds must not be presented as completed, and no automatic retry is performed. Earlier runner receipts may have a top-level `completed` label even when the provider response is `PENDING` or rejected. Read the provider response and comparison, which retain the correct outcome. New processes use `pending` or `rejected` instead.

A resumed chargeback pilot found PayPal dispute `PP-R-JBK-10199015` uniquely linked to sandbox capture `8LA54182LG8308219`, with the dispute `UNDER_REVIEW`. Its refund request received HTTP 422 `REFUND_NOT_PERMITTED_DUE_TO_CHARGEBACK`; the mock expected HTTP 201. The ledger correctly recorded a disagreement. The capture remained `COMPLETED` when re-read. This card chargeback is a different provider scenario from a wallet inquiry.

PayPal references: [sandbox card testing](https://developer.paypal.com/sandbox-testing/card-testing) and [expanded checkout orders](https://developer.paypal.com/api/rest/integration/orders-api/api-use-cases/advanced/).
