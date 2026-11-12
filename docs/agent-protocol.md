# External agent protocol

STILL can ask a locally running HTTP agent to choose each next action. The host owns the scenario, tool execution, PayPal credentials, and the evidence timeline. The agent proposes an action and receives its result in the next request. The host does not give the agent PayPal credentials.

The agent endpoint must use HTTP on `127.0.0.1` or `[::1]`. Redirects, URL credentials, and remote hosts are rejected. Run only an agent you trust. The endpoint receives the scenario conversation, including order and payment details.

## Request

The host sends a JSON POST with `Content-Type: application/json`:

```json
{
  "version": 1,
  "messages": [
    { "role": "system", "content": "Store policy and scenario instructions" },
    { "role": "user", "content": "Please cancel my order." }
  ],
  "tools": ["get_order", "cancel_order", "refund_order", "propose_fulfillment"]
}
```

`messages` is the complete conversation provided to the agent for this decision. Assistant messages may include `tool_calls`, and tool results have role `tool`, a `tool_call_id`, and JSON text in `content`. The agent must wait for the host's tool result before reporting an outcome. A new customer request is another `user` message. The host may provide a different conversation to a deliberately buggy agent.

## Response

Return HTTP 200 and a JSON object with `content` and `tool`. Set `tool` to `null` to finish the customer turn. A final response needs nonempty `content`.

```json
{ "content": "I will check the order.", "tool": { "name": "get_order", "arguments": {} } }
```

The supported tool proposals are:

- `get_order` with empty `arguments`. Its result includes the simulated `order_status`, either `OPEN` or `CANCELED`.
- `cancel_order` with empty `arguments`. The host cancels the simulated order idempotently and records the result. It does not cancel a real store order or refund the payment.
- `propose_fulfillment` with empty `arguments`. This proposes fulfillment; the host records and checks the decision.
- `refund_order` with string `amount` and `currency` arguments, for example `{ "amount": "50.00", "currency": "USD" }`.

To finish the turn, return `{ "content": "Your refund is complete.", "tool": null }`. The host rejects malformed responses, unknown tools, extra tool arguments, and empty final responses. A rejected response or an unreachable endpoint leaves the scenario inconclusive. The host limits each agent request to 60 seconds and the response to 1 MB. It does not follow redirects.

The adapter validates the response shape. The host decides whether and how to execute an accepted proposal and records the result. A refund proposal is a new decision, not a retry instruction. The host assigns its own PayPal request identifier.

## Example agent

Run `node examples/agent.mjs`. It listens at `http://127.0.0.1:8787/agent`. This scripted example reads the order before deciding whether to request a refund. It is a protocol fixture, not an AI agent and not proof of PayPal sandbox behavior. Stop it with Ctrl+C.

## Failures

The adapter rejects non-HTTP URLs, non-loopback hosts, credentials in the URL, fragments, and redirects. It rejects requests larger than 1 MB before sending them. Connection failures, timeouts, redirects, and non-success HTTP responses produce errors. The adapter does not expose a remote response body in an error. A success response must contain valid UTF-8 JSON no larger than 1 MB. `content` must be a string of at most 5,000 characters. `tool` must be present and either null or a supported proposal. A null tool requires nonblank content. Tool arguments must contain exactly the keys documented above. A malformed action ends the decision with an error. The host must mark an incomplete scenario inconclusive and must not infer a payment outcome from that error.

Set `AGENT_PORT` to use another port for the example, then configure the host endpoint to match. The example binds to loopback and has no authentication. Do not expose it to a network.

## Codex-backed example

Run `node examples/codex-agent.mjs` to start a local agent backed by the signed-in Codex CLI and `gpt-6.1-terra`. Set `AGENT_PORT` to choose a port. Point the host at `http://127.0.0.1:8787/agent`, or the port you chose. The example forwards the supplied conversation to Codex for each decision and returns one proposed action or a final reply. The host executes the tools and owns the PayPal credentials. This example requires a working signed-in Codex CLI. It binds to loopback and has no authentication, so run it only on a trusted machine. Stop it with Ctrl+C.

## Repeated-trial protocol version 2

Repeated trials use the same request and response envelope with `version` set to `2`. The `tools` array contains `get_order`, `get_dispute`, and `refund_order`. Version 1 is unchanged. The trial adapter is available through `createExternalTrialAgent` as described in [Connect a local agent to repeated trials](trial-agent.md).

`get_order` and `get_dispute` take empty arguments. `refund_order` accepts the optional string fields `amount`, `currency`, `requestId`, `orderId`, `customerId`, and `captureId`. A missing amount requests the remaining balance in the mock. A missing currency uses the scenario currency. A missing request ID provides no idempotency protection. The agent must reuse the same request ID and arguments to retry an uncertain operation. The host does not generate a request ID or target identity for the agent. Each argument is limited to 100 characters. Unknown fields are rejected.

The agent receives the full conversation for each action, including mock tool results. It must propose a dispute check itself. The mock and its responses are not evidence of a live PayPal operation.

### Synthetic customer follow-up

For a public-data amount-free refund scenario, Still can provide a predetermined synthetic customer response. The request's `tools` list then includes `request_refund_confirmation`. To ask for confirmation, propose that application action with exactly `{ "amount": "86.21", "currency": "USD" }`, using the actual approved amount and currency from the mock order. This is not a PayPal tool. Still records the request, a synthetic confirmation result and the customer's follow-up as a new `user` message, then asks the agent to decide again. The agent must still follow all refund rules. The example response is illustrative; use the amount and currency for the actual scenario.

Only the scenario's exact approved amount and currency can be confirmed, once, before any refund. Other scenarios, mismatches, repeated requests and incomplete results do not receive a synthetic reply and remain unverified unless a recorded rule violation establishes a failure. Free-text questions do not trigger an automatic reply. Account-derived personas do not receive this scripted confirmation. A trace containing this application action is not eligible for sandbox replay. The customer and follow-up are synthetic, not PayPal records.
