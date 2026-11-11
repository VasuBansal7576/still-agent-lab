# Frozen sandbox order recovery

Seven sandbox test-card order requests were interrupted before their claim journals recorded a capture. Their claim IDs, original request IDs, amounts and currencies were preserved. PayPal stores Orders API idempotency keys for six hours. The recovery command below uses the original request ID and exact pinned request implementation, and refuses requests older than five hours. It operates only on the fixed interrupted claim set and does not touch newer active claims.

```sh
node server/recover-frozen-orders.mjs CLAIM-ID
```

The command creates a one-use recovery journal before the sandbox request and verifies any returned capture with PayPal. If the first request never reached PayPal, the repeated request can create a new sandbox order. It does not call a refund. A missing, changed, expired or ambiguous claim is refused. An unknown recovery outcome must not be retried automatically. Records remain in `.data/frozen-order-recovery/` and contain no credentials or test-card details.

For a claim with a `capture-verified` recovery record, the explicit continuation command uses that same capture and original trial. It does not create an order. It confirms the capture again, creates a one-use continuation journal and uses Still's durable replay ledger to reserve the capture and trial before any refund.

```sh
node server/continue-frozen-replay.mjs CLAIM-ID
```

Only supported failures without an open-dispute requirement can be continued this way. The gateway does not establish complete external refund history or exclusive sandbox account access. Pending provider refunds remain pending; the mock comparison reports an actual outcome difference. An unknown refund outcome is not retried automatically. Continuation records are in `.data/frozen-replay-continuation/` and authenticated replay receipts are in `.data/replay-ledger/`.

PayPal reference: [Orders v2 create order](https://developer.paypal.com/sdk/orders/v2/orders-create/).
