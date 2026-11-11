# Replay checkout integration

`createReplayCheckout` creates a sandbox order for one ready item in a server-owned replay plan. It derives the capture amount and currency from the mock payment and checks that the trace contains one comparable, explicit refund. It does not approve or capture the order.

## Server contract

1. Read the saved batch on the server and build the plan with `planSandboxReplays`. Select the ready item on the server using the requested batch ID and queue index. Do not accept an item, amount, currency, adapter, or approval assertion from the request.
2. Call `createReplayCheckout({ session, item })` with the existing server session. Map `invalid` to 400, `unavailable` to 503, `conflict` to 409, and `create_unknown` to 502. Return only the existing public checkout fields and the currency. Do not serialize `requestId` or the full session.
3. For `approval_required`, show the amount and currency and open the returned sandbox approval URL for the buyer to approve. The browser then calls the existing capture endpoint. The server must verify PayPal's `APPROVED` order status before capture, as it does for the existing checkout.
4. Change `completedCapture` and every caller in capture, reconcile, and abandon to compare the capture currency with `checkout.currency ?? 'USD'` as well as the amount. Preserve the existing capture request ID, operation lock, and unknown-outcome behavior. Include currency in `publicCheckout`.
5. Execute only the same planned item identified by `checkout.replayKey`. Continue to require the provider-confirmed buyer approval, a matching completed capture, complete trusted refund history, and exclusive capture use in `executePlannedSandboxReplay`.

The helper sets `creating` before the provider call, so concurrent creates in the same session conflict. Any exception or incomplete create response leaves `create_unknown`, which blocks another checkout in that session. Do not automatically retry or abandon an unknown create. An application restart loses the in-memory session and its checkout state, so this helper alone does not prevent a duplicate across restarts. Persist and reconcile the create operation before offering restart-safe retries. The helper uses the session adapter and does not bypass its sandbox endpoint, request ID, or URL restrictions.

## Evidence and limits

The driving-test page prepares a matching checkout and exposes its buyer approval and capture controls. A synthetic provider fixture demonstrated local state transitions, but it cannot prove a PayPal order, buyer approval, capture, refund, or replay agreement. The existing replay route also lacks the trusted complete refund history needed to execute a replay. Those integrated and live outcomes remain unverified until their own evidence exists.
