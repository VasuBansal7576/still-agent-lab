# Opt-in mock refund outcomes

The default mock behavior remains a completed refund. The CLI can instead run all scenarios with an explicit mock provider outcome:

```sh
node bin/still.mjs test --personas 1 --trials 1 --mock-refund-outcome pending-echeck
node bin/still.mjs test --personas 1 --trials 1 --mock-refund-outcome refund-not-allowed
```

`pending-echeck` returns mock HTTP 201 and a `PENDING` refund with `status_details.reason` `ECHECK`. The mock reserves the requested amount in its isolated capture ledger, consistent with the observed sandbox capture becoming partially refunded. It does not simulate a later settlement or establish that all pending refunds reserve the same way. `refund-not-allowed` returns mock HTTP 422 with `REFUND_NOT_ALLOWED` and leaves the mock capture unchanged.

Both options are synthetic controls. They do not predict PayPal funding, an actual rejection, an eCheck clearing, or a sandbox response. A trial whose expected refund is pending or refused is unverified, not a pass, even if the mock accepted the refund request. Policy violations still fail independently. Idempotent replay of a pending mock response follows this mock's existing request-ID behavior; the pending retry response has not been independently verified against PayPal.

The sandbox pilot recorded actual pending and rejected responses in [sandbox-bulk-pilot.json](evidence/sandbox-bulk-pilot.json). The separate [sandbox-earned-gateway.json](evidence/sandbox-earned-gateway.json) records HTTP 201 `PENDING` and a later `PENDING` refund lookup. These observations support the modeled shapes, not a rule for when PayPal will select an outcome.
