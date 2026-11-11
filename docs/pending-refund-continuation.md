# Continue a pending sandbox replay

`server/continue-pending-refund.mjs` can execute the second recorded sandbox refund call after a confirmed `PENDING` first refund. It is limited to saved non-dispute mock failures with exactly two refund calls and an authenticated one-attempt sandbox receipt. It re-reads the original refund and capture from PayPal, then creates a private, durable one-use journal before the second call. It reuses the original request ID when both calls share a decision ID. For a distinct decision it generates a stable new ID. It never retries a transport-unknown response.

```sh
node server/continue-pending-refund.mjs BATCH-ID PERSONA-ID TRIAL
```

The journal lives under `.data/pending-refund-continuations/`. It is separate from the original immutable replay receipt. This is a delayed continuation rather than an immediate replay. The sandbox capture and refund checks do not establish exclusive account access or complete refund history. An uncertain outcome must not be automatically retried.

On November 12, 2026 local time, the first sandbox refund on capture `7HR537055H1543917` was confirmed `PENDING`. The distinct second recorded call returned HTTP 201 and a different refund ID, also `PENDING`. Subsequent PayPal GETs reported both refunds `PENDING` and the capture `REFUNDED`. Neither refund is proven completed. [Sanitized evidence](evidence/sandbox-pending-continuation.json) records the calls and states.

The continuation is not yet folded into the authenticated mock-to-sandbox agreement score. It demonstrates the second provider call for this case; it does not establish a full replay or a pass.

A separate report combines the authenticated original receipt with the one-use continuation journal. It preserves the original provider statuses, compares both observed calls with the saved mock, and labels the delayed timing. It never modifies the original receipt or includes the comparison in the aggregate score.

```sh
node server/compare-pending-continuation.mjs BATCH-ID PERSONA-ID TRIAL
```

The [pilot comparison](evidence/sandbox-pending-continuation-comparison.json) reports a disagreement because both actual refunds were pending while the mock expected completion. The relative refund ID identity matched the two distinct mock decisions.
