# Additional sandbox leak demonstrations

`runExtraLeakDemo` in `server/extra-leak-demo.mjs` accepts a trusted server-owned session, the sandbox PayPal adapter, a scenario ID, and a durable reservation callback. The browser must not supply the session, adapter, or callback. Use a new $100 USD captured checkout for each run. The session must contain the checkout, its capture ID and order ID, a set of captured IDs, and a set of spent IDs.

The reservation callback receives the capture ID, order ID, request ID, and scenario ID. It must atomically and durably reserve the capture before returning `true`, mark it spent in the session, and refuse every later use. Reservation happens before the capture lookup. A failed lookup or uncertain refund remains reserved across restarts. Reconcile uncertain outcomes with PayPal before considering any further action. Never retry automatically. The callback must return `false` if it cannot guarantee exclusive use. The caller must bind the adapter to the sandbox endpoint and must not pass production credentials.

Each scripted buggy agent makes one refund request. The $50 approved return, customer identities, and the requested order in the wrong-order case are synthetic scenario facts. The capture, refund request, and provider response are sandbox evidence. A wrong-order case compares a synthetic requested order with the actual checkout order. A wrong-customer case compares synthetic requester and owner identities for that checkout. Neither demonstrates verification of a real customer's identity. The deterministic rule fails on the request, including when PayPal rejects it. A thrown request leaves the provider outcome unverified.

The `omitted-amount` case requires `paypal.refundCaptureWithoutAmount(captureId, { requestId })`. The sandbox-only client in `server/paypal.mjs` validates both IDs and sends an empty object to the capture refund endpoint with the supplied request ID. Do not silently substitute the capture amount. Record the actual PayPal response and do not claim a completed full refund unless the response confirms it.

Each scenario requires a fresh sandbox checkout to establish its live outcome. No real money is used.
