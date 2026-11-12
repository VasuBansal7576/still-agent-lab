# Read-only sandbox check for uncertain refunds

Run `node server/reconcile-uncertain-refunds.mjs` on the machine holding the private batch, replay ledger and sandbox credentials. The command authenticates the recorded sandbox receipts, checks the one-use delayed journal where applicable, and reads the five matching capture records from PayPal sandbox. It sends no refund request and does not modify the original replay receipts.

On November 12, 2026, a [sanitized read-only observation](evidence/uncertain-refunds-readonly.json) returned HTTP 200 and matching capture amounts for all five captures. Four were `COMPLETED`; the fifth was `PARTIALLY_REFUNDED` after an earlier recorded pending refund. Neither capture status establishes what happened to the later refund request that received HTTP 503. All five uncertain refund outcomes remain unverified.

PayPal's [API request guidance](https://developer.paypal.com/api/rest/requests/) states that refund request IDs can be retained for up to 45 days and idempotent retries depend on the server still storing the ID. The sandbox refund endpoint does not expose whether a particular request ID is still stored. The recorded 503 response and a missing transaction-report match do not establish whether the original refund was processed. Still makes no automatic retry of these uncertain calls.
