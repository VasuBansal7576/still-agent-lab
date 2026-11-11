# Second sandbox 503 recovery

The claim `e6c7893ff1390e5c3a3ff7b91260ced5e93063b9eb4adcedc682bbcc347db475` ended with HTTP 503 during a sandbox test-card order. The guarded recovery used its original PayPal request ID within the documented retention period. PayPal returned HTTP 201, so the first request may not have reached PayPal. A separate capture lookup confirmed `5AV20604AT8221032` was `COMPLETED` for GBP 366.77.

The original failed trial required an open dispute. `continue-second-503-replay.mjs` created a sandbox card chargeback but stopped without refund when PayPal's dispute list had not yet returned an ID. A later transaction-filtered lookup returned `PP-R-SOH-10199156` linked to that exact capture. `resume-second-503-dispute.mjs` rechecked the existing case and the one-use replay reservation before requesting the refund. PayPal reported the case `UNDER_REVIEW` and refused the GBP 183.38 refund with HTTP 422 `REFUND_NOT_PERMITTED_DUE_TO_CHARGEBACK`. The mock expected 201, so Still recorded a disagreement. This is a card chargeback, not a wallet inquiry. No real money moved.

The continuation and resume journals are in `.data/order-503-continuation/` and `.data/order-503-resume/`. Both commands are scoped to this claim and are one-use. Do not repeat an uncertain action automatically.
