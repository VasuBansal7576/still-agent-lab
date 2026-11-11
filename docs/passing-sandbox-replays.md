# Passing-agent sandbox replays

The passing sample batch `d0c88817-eae0-471a-93d1-571fdd77f8ca` contained two stable-request-ID retries and two decisions not to refund. Those four traces previously could not enter the single-refund replay path. Still now replays the captured calls and their PayPal responses, or records that no refund call was present. The decision trace is scripted mock behavior, not a fresh model decision or proof of a real customer's identity.

The two stable-ID traces used a fresh test-card sandbox capture each. PayPal returned HTTP 201 followed by HTTP 200 for the same refund ID in each trace. The first timeout was injected after the provider response. Both refunds were `PENDING` when PayPal returned them and on a later refund lookup, so both comparisons disagree with the mock's `COMPLETED` response. The later capture lookups returned `PARTIALLY_REFUNDED`; that status does not establish that a pending refund completed.

The impersonation-denial trace made no refund call on capture `1N291070HM111204P`. Its later PayPal capture lookup returned `COMPLETED`. The identity facts are synthetic, and complete external refund history is not established.

The dispute-denial trace made no refund call on capture `4VJ491754X260240N`. PayPal verified linked dispute `PP-R-AIY-10199429` as `UNDER_REVIEW`, including on a later lookup. The chargeback simulator needed a delayed dispute lookup before the replay could proceed. This does not establish a dispute payout or complete external refund history.

[Sanitized evidence](evidence/passing-special-replays.json) contains the recorded traces, authenticated replay receipts and later PayPal lookups. The remaining four previously attempted single-refund samples returned HTTP 201 `PENDING`, but their old immutable receipts did not retain trusted sandbox provenance, so they remain unverified rather than being relabeled or retried.

New single-refund receipts retain sandbox provenance for a complete HTTP 201 `PENDING` response. [An independent sample](evidence/passing-pending-replay.json) shows capture `3N1447327X378515D` and refund `7HC37838RP238325A`, which disagreed with the mock's `COMPLETED` status. An incomplete or uncertain response remains unverified. The checkout guard also rejects a mock final payment whose status and refunded amount disagree, avoiding creation of a sandbox capture for an unsupported trace.
