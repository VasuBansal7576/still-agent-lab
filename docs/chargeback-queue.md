# Delayed sandbox chargeback queue

`server/resume-chargeback-queue.mjs` revisits distinct sandbox chargeback claims whose PayPal dispute ID was not available during the original bounded wait. It does not create a new order or chargeback. By default it inspects up to 5,000 claims, covering the requested 5,000-trial batch. A smaller limit inspects only the first matching claims, so it does not cover the rest of the queue.

```sh
node server/resume-chargeback-queue.mjs BATCH-ID 5000 2 observe
node server/resume-chargeback-queue.mjs BATCH-ID 5000 2 execute
```

Each round scans its selected distinct claims and uses bounded backoff between rounds. `observe` only reads PayPal. `execute` first verifies the exact capture is completed and that one unresolved sandbox dispute is linked to it. It then creates the same one-use `.resume` claim used by the existing batch runner, checks the original journal did not change, and uses the existing durable replay ledger to reserve the capture and trial before any refund. It never repeats a chargeback or automatically retries an uncertain refund. Authentication failures, rate limits, server errors and uncertain refund outcomes stop the run. Sandbox capture and dispute facts do not establish complete external refund history or exclusive account access.

On November 12, 2026 local time, an `observe` pass over 15 claims found nine ready and six deferred. An `execute` pass on those 15 claims attempted nine existing sandbox captures exactly once. All nine comparisons disagreed with the mock: eight refunds were rejected and one was pending. Six claims remained deferred. For capture `61P8728657149900M`, PayPal confirmed dispute `PP-R-BAW-10199190` was `UNDER_REVIEW` and returned HTTP 422 `REFUND_NOT_PERMITTED_DUE_TO_CHARGEBACK`; the authenticated ledger retained the response. Card chargebacks are not wallet inquiries. A provider refusal or pending refund is compared with the mock and is not a passing refund.
