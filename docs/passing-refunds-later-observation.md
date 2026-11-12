# Later PayPal sandbox refund observations

Four passing-sample receipts in batch `d0c88817-eae0-471a-93d1-571fdd77f8ca` were retained as unverified because the old executor did not mark their provider provenance. Still must not rewrite those receipts or retry the refunds.

`node server/reconcile-passing-refunds.mjs d0c88817-eae0-471a-93d1-571fdd77f8ca` reads the saved mock traces and private ledger, then makes read-only GET requests to PayPal sandbox for the recorded captures and refund IDs. It verifies each PayPal refund's `up` link to its capture and compares the currency and amount with the saved trace. It makes no payment or refund requests.

The [sanitized observations](evidence/passing-refunds-later-observation.json) show that PayPal returned HTTP 200 for all four refunds and captures. Each refund was still `PENDING`, each capture was `PARTIALLY_REFUNDED`, and each refund linked to the expected capture. All four current refund statuses disagree with the mock's `COMPLETED` status.

These are later provider observations, not authenticated evidence of the original executor's HTTP response timing. They do not change the original immediate replay agreement score, prove that a pending refund completed, establish complete refund history, or prove exclusive access to the sandbox account. The four original receipts remain unverified.
