# Sandbox evidence-submission settlement probe

On 2026-11-12, Still checked whether submitting seller evidence could settle a pending capture associated with a sandbox chargeback. This was a single sandbox-only probe on a fresh replacement case; it did not change the original replay records or initiate a refund.

| Observation | Before submission | After submission |
| --- | --- | --- |
| Capture `7TF93436A04568915` | HTTP 200, `PENDING` | HTTP 200, `PENDING` |
| Dispute `PP-R-JJJ-10199975` | HTTP 200, `WAITING_FOR_SELLER_RESPONSE`, `CHARGEBACK` | HTTP 200, `UNDER_REVIEW`, `CHARGEBACK` |
| Seller evidence | `OTHER` requested; `provide_evidence` available | No longer requested; `provide_evidence` unavailable |
| `adjudicate` link | Unavailable | Unavailable |

The dispute response identified the capture as its seller transaction. One synthetic `OTHER` evidence submission returned HTTP 200 at 07:31:36 UTC. Both after-state reads completed at 07:31:37 UTC. The probe journal contains no credentials or tokens. The capture remained pending immediately after submission; a later transition was not established by this probe. A resolved or under-review case is also not equivalent to replaying the original open-dispute scenario.

PayPal documents sandbox adjudication for eligible disputes with an `adjudicate` link in its [dispute testing guidance](https://developer.paypal.com/disputes/test-go-live/). That link was absent here. The [webhook simulator](https://developer.paypal.com/api/rest/webhooks/simulator/) sends mock events and does not establish a real transaction state change. Neither supplies evidence that these captures can be settled on demand.

Separately, the existing read-only state checker observed 78 replacement captures in batch `53b0e9b5-f2f9-4899-bbb2-33786539a98a` as HTTP 200 `PENDING` with no refunds on 2026-11-12, before this probe. The remaining live dispute replay cases are still unverified.

The single-use script `server/probe-sandbox-evidence-settlement.mjs` records its precondition and submission intent locally before sending the request. Its local reservation prevents accidental repeat submissions.
