# Deferred sandbox dispute recheck

On November 12, 2026, Still rechecked all 407 deferred chargeback cases from batch `40f79126-1d0a-4152-b23d-5ef9c221e7ce` with `node server/resume-chargeback-queue.mjs 40f79126-1d0a-4152-b23d-5ef9c221e7ce 5000 1 execute`. PayPal's capture and linked-dispute checks found zero ready cases. All 407 remained deferred. The scan completed without a provider error and attempted no refunds.

Three separately saved pre-reservation cases were checked individually around 03:39 UTC. PayPal returned HTTP 200 `PENDING` for captures `00L51783WX566741G`, `4EJ72960728865022`, and `9M065972JR897290S`. Their linked disputes `PP-R-JNH-10199087`, `PP-R-CJI-10199094`, and `PP-R-JEA-10199038` were `WAITING_FOR_SELLER_RESPONSE`. The capture was not `COMPLETED` for any of these three, so Still did not attempt a refund. The individual checks and the 407-case scan are separate groups.

These are sandbox-only observations. A pending capture is not a completed payment, and a missing eligible dispute is not proof that no dispute exists. The deferred cases remain unverified until PayPal provides the capture and dispute evidence required by the replay guard.
