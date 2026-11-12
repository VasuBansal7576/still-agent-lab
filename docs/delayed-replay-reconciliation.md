# Delayed replay reconciliation

`summarizeDelayedReplays(batchId)` in `server/delayed-replay-reconciliation.mjs` reads the saved mock batch, authenticated replay receipts, and one-use delayed continuation journals. It validates each journal against its original replay and reports counts, reasons for unverified cases, and a few example comparisons. It makes no network calls or payment actions. The original receipts remain unchanged.

On November 12, 2026, the saved 5,000-failure batch `40f79126-1d0a-4152-b23d-5ef9c221e7ce` had 769 continuation journals. Of those, 768 had complete, comparable PayPal responses and disagreed with the original mock. One response was a PayPal HTTP 503 and remains unverified. The [sanitized summary](evidence/delayed-replay-reconciliation.json) includes representative mock and PayPal response details.

These are **delayed** continuations, not immediate replays. They remain separate from the original aggregate agreement score. A pending refund is not a completed refund, and a provider error is not proof that a refund failed. The summary does not establish exclusive account access or complete PayPal refund history.

Run the saved-record comparison with `node server/delayed-replay-reconciliation.mjs 40f79126-1d0a-4152-b23d-5ef9c221e7ce`. The original single-case interface remains available in `server/compare-pending-continuation.mjs`.
