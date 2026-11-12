# Fresh sandbox replays for deferred disputes

Still can create a **new** sandbox attempt for an original failed trial whose earlier card chargeback was accepted but whose dispute could not be verified. It copies the saved mock trial without changing its calls or expectations. The replacement has its own batch ID, fresh PayPal sandbox test-card capture, sandbox card chargeback, claim, replay receipt, and mapping back to the original trial. The earlier capture, claim and historical result are unchanged. A later replacement is not proof of the outcome of the earlier attempt.

Run from the repository with the connected sandbox credentials:

```sh
node server/fresh-dispute-replay-queue.mjs BATCH-ID COUNT WORKERS
```

The maximum count is 5,000, with 1 to 8 workers. The command selects only supported failed trials whose original claim recorded a fresh completed capture and an accepted but unverified chargeback. It skips original trials with an authenticated replay receipt. An exclusive, durable per-original reservation prevents Still from automatically creating a second replacement for the same trial. A reservation is written before a replacement batch or provider call; if interrupted before the batch is saved, it stays reserved for manual reconciliation, not automatic replay. The replacement batch stores the original trial keys in `replacementOf`.

The existing sandbox runner journals each order and capture, verifies an unresolved dispute linked to that exact capture, reserves each refund once, and stops scheduling new work on uncertain provider responses, authentication errors, rate limits or server errors. A PayPal chargeback may be accepted before its dispute ID appears. Use the existing guarded delayed scan for a replacement batch:

```sh
node server/resume-chargeback-queue.mjs REPLACEMENT-BATCH-ID 5000 1 execute
```

That scan sends a refund only when PayPal confirms the matching capture is still completed and exactly one unresolved dispute is linked to it. A pending capture or unavailable dispute remains unverified. The comparison is sandbox-only and does not prove complete external refund history, exclusive account access or real customer identity. Never delete reservations to force a retry.

For a fresh replacement batch only, `node server/resume-fresh-disputes.mjs REPLACEMENT-BATCH-ID 5000 4` performs the same checks with up to four workers. It shares the original scan's atomic per-claim `.resume` reservation and the replay ledger. The scanner stops scheduling after a transport failure, 401, 403, 429, 5xx, or uncertain refund. Operations already in flight may finish. On a 50-case sandbox pass, 18 cases were ready and produced authenticated disagreements; 32 remained deferred. This is an operational sample, not proof that the remaining captures will become eligible.

On November 12, 2026, one separately created replacement and a five-case replacement batch completed this journey. All six authenticated comparisons disagreed with the original mock: PayPal returned HTTP 422 `REFUND_NOT_PERMITTED_DUE_TO_CHARGEBACK` where the mock expected an HTTP 201 completed refund. [Sanitized evidence](evidence/fresh-dispute-replay-pilot.json) includes the verified capture, linked dispute and refund response for each comparison. These are card chargebacks, not wallet inquiries. No real money moved.

The larger replacement batch `53b0e9b5-f2f9-4899-bbb2-33786539a98a` reserved 401 remaining eligible original trials. A dated [in-progress checkpoint](evidence/fresh-dispute-replay-checkpoint.json) records 247 authenticated comparisons, all disagreements, and 154 unverified cases. The latter include cases queued, in flight or awaiting PayPal state. Creating the batch is not proof that all replays completed. The original 5,000-trial batch's score is not changed by these replacement results.
