# Model-driven toolkit gateway example

The example uses a passing local v3 batch to derive a mock-only permission. `gpt-6.1-terra` receives the PayPal OpenAI toolkit definitions and chooses each action through Codex structured output. The toolkit wrapper routes those calls through MCP to Still's gateway. The gateway uses a synthetic order, capture, and dispute state. It does not call PayPal. The host-selected batch does not authenticate the agent, so this is not proof that the client is the same agent that earned the permission.

Install the pinned toolkit and MCP SDK as described in [toolkit trials](toolkit-trials.md), sign into the Codex CLI, and provide the UUID of a qualifying local v3 batch:

```sh
STILL_TOOLKIT_INSTALL=/private/tmp/still-toolkit-check node examples/toolkit-v3-mcp-model.mjs BATCH-UUID
```

The example tells the model the mock gateway's supported argument restrictions. Each process uses one host-supplied decision ID; mock state resets when it exits. This uses structured output rather than native OpenAI function calling. Model output can vary, and the example exits unsuccessfully if the ordered journey does not complete.

In the [recorded mock journey](evidence/toolkit-v3-model-gateway.json), the model chose an order lookup, a capture-scoped complete dispute listing, and an eligible USD 1.00 refund. The gateway returned a completed mock refund. An earlier attempt used unsupported pagination arguments; the gateway blocked the dispute lookup and the model did not refund. That attempt remains unverified. These observations do not establish live PayPal behavior or compatibility with arbitrary agents.
