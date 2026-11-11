# Recover the interrupted 503 sandbox order

The guarded recovery below is scoped to one sandbox bulk-replay claim. It reuses the exact original order request ID and request implementation within five hours of the original request. PayPal documents six-hour Orders API request-ID retention. If the original request never reached PayPal, the repeated call can create a sandbox order. It does not request a refund.

```sh
node server/recover-503-orders.mjs cb9848e341b42a45440fe96002acf94d50bf205996a0abec786574d942a2d60d
```

The recovered claim belongs to an open-dispute trial. `continue-503-replay.mjs` creates one sandbox card chargeback and must confirm a unique PayPal dispute linked to the recovered capture before making any refund. It reserves a private one-use journal before the provider action. If PayPal accepts a chargeback but its ID is not yet visible, the result remains unverified. Never rerun the creation command for an uncertain outcome.

```sh
node server/continue-503-replay.mjs cb9848e341b42a45440fe96002acf94d50bf205996a0abec786574d942a2d60d
node server/resume-503-dispute.mjs cb9848e341b42a45440fe96002acf94d50bf205996a0abec786574d942a2d60d
```

The second command resumes only a previously accepted, unverified chargeback. It reads PayPal's transaction-filtered disputes, verifies one unresolved dispute on the exact capture, creates another one-use journal, and uses the replay ledger's durable reservation before requesting the refund. It does not create another order or chargeback. If a refund outcome is unknown, it is not retried automatically. The commands are specific to the recorded claim and cannot recover arbitrary claims.

On November 11, 2026 UTC, the recovered capture `79X799901D710392R` was confirmed `COMPLETED` for GBP 313.40. PayPal accepted a sandbox card chargeback, later reported dispute `PP-R-TYX-10199150` as `UNDER_REVIEW` on that capture, and refused the GBP 156.70 sandbox refund with HTTP 422 `REFUND_NOT_PERMITTED_DUE_TO_CHARGEBACK`. The mock expected HTTP 201, so the authenticated replay reported a disagreement. The chargeback is not a PayPal wallet inquiry and no real money moved.

Reference: [PayPal Orders API](https://developer.paypal.com/sdk/orders/v2/orders-create/).
