# Deferred sandbox chargeback observations

On November 12, 2026, ten deferred card-chargeback claims were checked against PayPal sandbox. Each claim recorded a completed capture before the chargeback simulator ran. PayPal returned HTTP 200 `PENDING` for all ten captures when re-read. This sample does not establish the state of every deferred capture.

The [single changed-state probe](deferred-chargeback-state-probe.md) confirmed the local claim had no prior Still refund reservation, reserved the claim and capture once, and received PayPal HTTP 422 `REFUND_NOT_PERMITTED_DUE_TO_CHARGEBACK`. Its result remains separate from the original completed-capture replay.

The requested bulk continuation required proof that no prior refund had been attempted for each capture. Still's journal and reservations establish only its own recorded activity. PayPal capture details do not provide complete external refund history, and transaction reporting can lag. The system therefore cannot establish that no other or pending refund exists for each capture. The remaining bulk refund attempts were not made. An unrecorded refund must not be assumed absent.

The original mock comparisons remain unverified. To make a later bulk attempt, establish complete transaction history and exclusive access for each fresh sandbox capture, verify its linked dispute and current state, then use durable one-use reservations. Unknown PayPal outcomes must remain unverified.
