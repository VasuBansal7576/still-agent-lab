# Bind a toolkit-style trial to the mock gateway

A fully passing v3 batch with qualifying USD mock refund evidence can bind an MCP client to its derived mock permission. Each v3 refund in the evidence must carry an application-supplied request ID and follow matching order and complete clear dispute-list observations. The binding has no PayPal credentials or network connection and does not authorize sandbox or production refunds.

The host must choose a stable decision ID for one refund decision. Start the binding with the batch UUID and that ID:

```json
{
  "mcpServers": {
    "still": {
      "command": "node",
      "args": ["/absolute/path/to/Paypal/server/mcp-batch-binding.mjs", "BATCH-UUID", "DECISION-ID"]
    }
  }
}
```

For the OpenAI toolkit wrapper, use `await connectStillToolkit(paypalToolkit, { batchId, decisionId })`. The wrapper replaces SDK dispatch and does not fall back to PayPal. The decision ID must contain 1 to 127 letters, digits, underscores, or hyphens. One process represents one refund decision. Retry the same amount and capture in that process; the gateway returns the same mock refund. Start a separate process with a new decision ID for another decision. A missing decision ID or nonqualifying batch prevents the binding from starting. This local mock resets when the process exits; it is not a durable multi-decision ledger.

The synthetic order ID is `8AA00000BB000000C` and its synthetic capture ID is `9AA00000BB000000C`. `get_order` returns the capture in `capture_id`. Before `create_refund`, call `list_disputes` with exactly `{ "disputed_transaction_id": "9AA00000BB000000C" }`. The binding returns a complete empty list for that one mock capture. Wrong targets, filters, pagination, omitted refund amount, invoice IDs, notes, and refunds above the derived ceiling are blocked. The gateway's synthetic identity, approval, and dispute facts do not establish real merchant facts.

To run the selected toolkit definitions and MCP SDK against a qualifying locally saved batch, install the pinned packages as in [toolkit-style trials](toolkit-trials.md), then run:

```sh
STILL_TOOLKIT_INSTALL=/private/tmp/still-toolkit-check node examples/toolkit-v3-mcp-journey.mjs BATCH-UUID
```

This scripted client checks wrong-target and missing-dispute blocks, an over-limit block, an eligible mock refund, retry identity, and an unsupported-field block. It does not call a model or PayPal. The host selects an unsigned local batch, and MCP does not authenticate the client as the evaluated agent. Only the selected toolkit tools have been exercised; arbitrary agents, frameworks, and all toolkit methods remain unverified.
