# Opt-in mock refund outcomes

The default mock behavior remains a completed refund. The CLI can instead run all scenarios with an explicit mock provider outcome:

```sh
node bin/still.mjs test --personas 1 --trials 1 --mock-refund-outcome pending-echeck
node bin/still.mjs test --personas 1 --trials 1 --mock-refund-outcome refund-not-allowed
```

`pending-echeck` returns mock HTTP 201 and a `PENDING` refund with `status_details.reason` `ECHECK`. The mock reserves the requested amount in its isolated capture ledger, consistent with the observed sandbox capture becoming partially refunded. It does not simulate a later settlement or establish that all pending refunds reserve the same way. `refund-not-allowed` returns mock HTTP 422 with `REFUND_NOT_ALLOWED` and leaves the mock capture unchanged.

Both options are synthetic controls. They do not predict PayPal funding, an actual rejection, an eCheck clearing, or a sandbox response. A trial whose expected refund is pending or refused is unverified, not a pass, even if the mock accepted the refund request. Policy violations still fail independently. Idempotent replay of a pending mock response follows this mock's existing request-ID behavior; the pending retry response has not been independently verified against PayPal.

The sandbox pilot recorded actual pending and rejected responses in [sandbox-bulk-pilot.json](evidence/sandbox-bulk-pilot.json). The separate [sandbox-earned-gateway.json](evidence/sandbox-earned-gateway.json) records HTTP 201 `PENDING` and a later `PENDING` refund lookup. These observations support the modeled shapes, not a rule for when PayPal will select an outcome.

## Sandbox test-card profile

Select **Sandbox test-card observations** in the driving test, or run `node bin/still.mjs test --personas 1000 --trials 5 --mock-profile sandbox-test-card`. The profile simulates an eligible refund as HTTP 201 `PENDING` with the eCheck reason. When a simulated dispute is open, it models the test-card chargeback probe's HTTP 422 `REFUND_NOT_PERMITTED_DUE_TO_CHARGEBACK`. The default completed profile remains available for the wallet-style completed-refund cases. An open simulated dispute in the test-card profile represents a card chargeback, not a wallet inquiry.

This is an opt-in deterministic stress scenario. PayPal may return other outcomes for identical-looking inputs. Pending is not completed; it cannot earn a pass merely because the mock accepted a request. The profile does not predict when PayPal will choose an outcome and does not prove sandbox or production behavior.

The profile was based on the pilot and the separately recorded [chargeback probe](evidence/sandbox-chargeback-probe.json). A retrospective held-out slice of authenticated test-card receipts excluded the pilot examples and selected keys with SHA-256 starting in `0`. Of 4,510 ledger receipts, 15 were outside this batch, three were cited pilot examples and 4,209 were outside the hash slice. The remaining 283 all had trusted sandbox provenance, test-card funding, a matching completed capture and a first HTTP 201 or 422 refund response. The [saved comparison](evidence/mock-profile-holdout.json) found the profile matched all 283 first responses, while the completed profile matched none. The slice contains 272 pending responses and 11 chargeback refusals. This comparison covers only the first provider response, not whole traces, later settlement, or unknown outcomes. The slice was selected after the bulk results had been observed; it is not a prospective experiment or a representative merchant sample. Run `node server/mock-fidelity-eval.mjs` on the machine holding the private batch and ledger to regenerate it.

A new 10-persona buggy mock batch was generated through the application with the test-card profile. Its ten failure traces were then replayed on fresh sandbox captures. Nine initially agreed; one waited for PayPal to reveal the linked card dispute. A guarded later replay verified the dispute and returned the predicted HTTP 422 chargeback refusal, yielding 10 agreements and no unverified cases for this small batch. [Recorded provider responses](evidence/mock-profile-live-replays.json) include pending refunds and the dispute result. Pending refunds are not completed. This selected small batch does not establish general agreement or real-world rates.
