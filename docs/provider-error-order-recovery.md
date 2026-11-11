# Recover a sandbox order after a provider error

`server/recover-provider-errors.mjs` is a guarded recovery for server-owned bulk replay claims that ended with PayPal HTTP 500 or 503 while creating a sandbox test-card order. It does not issue refunds and never uses a live PayPal endpoint.

```sh
node server/recover-provider-errors.mjs CLAIM-ID
```

The command requires the exact original request implementation, a terminal three-entry claim, its original request ID and amount and currency, and an age of at least two minutes but less than five hours. PayPal documents six-hour Orders request-ID retention. A one-use recovery journal is fsynced before the sandbox call, and existing replay reservations or a changed claim stop the operation. If PayPal did not receive the original request, reusing its ID may create a sandbox order. Unknown results are not retried automatically. A successful recovery re-reads the matching completed capture; the original trial still needs a separately guarded replay.

On November 11, 2026 UTC, recovery of 503 claim `330e316f1424f64e5815684ed0fa4db5ba3c653c54829299f35ddb8040a5576a` returned sandbox HTTP 201 for order `9DU42535WH469091E`; PayPal then confirmed capture `3HM513909D331193E` was `COMPLETED` for GBP 598.60. This does not prove the original request created the order. No refund was requested.

Reference: [PayPal Orders v2 create order](https://developer.paypal.com/sdk/orders/v2/orders-create/).

A second terminal HTTP 500 claim, `684aecca0fbcb371d9403e87a313c6c8d34556d11bb9c5e322a8e038acb635af`, was recovered with its original ID. PayPal returned HTTP 201 and confirmed capture `35910423JF668834G` was `COMPLETED` for GBP 637.50. Neither recovery requested a refund.

The following command is scoped to those two verified non-dispute claims. It checks the original trial and capture, creates a private one-use continuation journal, rechecks PayPal and then uses the existing replay ledger reservation. It never creates another order or automatically retries an uncertain refund.

```sh
node server/continue-provider-error-replay.mjs CLAIM-ID
```

Both recovered trials were continued once. PayPal returned HTTP 201 with `PENDING` refunds `9YE82769LW553142S` for GBP 598.60 and `15C31192HE6608632` for GBP 637.50. Both authenticated comparisons disagreed with their mock `COMPLETED` outcomes. Neither pending refund is a completed refund.
