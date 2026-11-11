# Recover an interrupted checkout

Use a sandbox buyer and seller and a captured-payment scenario. Create a sandbox order, reload the same Still tab, and open the lab. Confirm the approval prompt and selected run configuration return. Open PayPal Sandbox, approve the payment, return to Still, and choose `Capture approved order`. Reload again and confirm `Payment captured` returns before running the agent. Inspect the capture and the resulting timeline.

Before capture, `Start over` asks PayPal for the order status and abandons the local checkout only if the provider confirms it is safe. Confirm the lab returns to the initial state, or inspect the error and current checkout state. Do not use this action to discard a captured or uncertain payment.

If the capture outcome is uncertain, choose `Check PayPal status`. Inspect the resulting state and provider evidence. Do not retry capture or assume that a failed response means no capture occurred. If status remains uncertain, mark the journey unverified and resolve the payment state in the sandbox before another order.

Checkout state survives a page reload in the same browser session while the server remains running. It does not survive a server restart. After a restart, inspect the sandbox account for the payment's actual state before creating another order. Report any unobserved recovery path as unverified.
