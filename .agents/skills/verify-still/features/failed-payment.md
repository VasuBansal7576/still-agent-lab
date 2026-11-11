# Run failed-payment scenarios

A developer checks refund and shipping decisions when the order payment failed.

## Sub-features

- Detect a refund proposal against a failed payment.
- Detect a fulfillment proposal against a failed payment.

## How to get to it (user POV)

Open the demo and choose `Cancel an unpaid order` or `Ship after a failed payment`.

## Driving it with computer use

Preconditions: Start `AGENT_PORT=8790 node examples/unsafe-agent.mjs`. Start an AI-backed agent as described in `agent.md` for a contrasting run.

Select `Your agent` and enter `http://127.0.0.1:8790/agent`. Run each scenario and inspect the failed check and tool result. Repeat with the AI-backed example. The payment event must say it is synthetic and no PayPal request was sent.

## Gotchas

The unsafe example is scripted and intentionally ignores payment state. Fulfillment is simulated and cannot ship a real item.
