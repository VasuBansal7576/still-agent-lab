# PayPal toolkit sandbox scenario

`server/mcp-sandbox-scenario.mjs` connects the selected PayPal Agent Toolkit OpenAI tools to Still's earned sandbox gateway through MCP. It is a controlled demonstration, not a general production connector. Starting the server creates a fresh USD 100 sandbox test-card capture. It uses the saved sandbox credentials and a USD permission earned from a passing local batch and an authenticated sandbox replay. No production endpoint is used.

The host-created scenario has a synthetic customer and a synthetic USD 50 approved return. The MCP client uses `get_order` with `sandbox-order` to retrieve the real sandbox capture ID, `get_dispute` with `sandbox-dispute` to obtain a PayPal lookup observation, and `create_refund` with that capture ID and an explicit USD amount. The gateway checks the earned ceiling, scenario identity and approval, actual capture, and PayPal dispute lookup before reserving the capture and sending a refund. A missing dispute in the lookup is reported as `UNVERIFIED`, not proof of absence. The scenario does not establish complete external refund history or exclusive account access. A durable reservation prevents another refund on that capture through Still after restart. An uncertain provider response must not be retried automatically.

Install PayPal Agent Toolkit 1.11.0 and the MCP SDK as described in [actual-toolkit](actual-toolkit.md), connect a PayPal sandbox app through Still, and provide a saved passing batch with qualifying sandbox evidence. Run from the project directory:

```sh
STILL_TOOLKIT_INSTALL=/private/tmp/still-toolkit-check node examples/toolkit-sandbox-journey.mjs BATCH-UUID
```

This command creates a new simulated capture and requests one USD 1 sandbox refund. It then repeats the request through the gateway to show it is blocked before a second PayPal refund call. It sends no real money. The local journal under `.data/toolkit-sandbox-scenarios` records provider results without credentials or arbitrary tool arguments. The toolkit binding supports `get_order`, `get_dispute`, `create_refund`, and a read of the refund created in the same process. Other tools, direct PayPal toolkit dispatch, real store facts, and production accounts are not supported. The scripted example uses actual toolkit definitions and MCP; it does not demonstrate a new model decision.

On November 12, 2026, the scripted journey used PayPal Agent Toolkit 1.11.0 and the MCP SDK with passing batch `d0c88817-eae0-471a-93d1-571fdd77f8ca`. PayPal confirmed USD 100 capture `71S24057FE151144U`, and the gateway sent one USD 1 sandbox refund. PayPal returned HTTP 201 for refund `45372113TY879554S` with `PENDING` status. The gateway blocked a repeated request without another PayPal refund call. Later PayPal GETs returned the capture as `PARTIALLY_REFUNDED` and the refund as `PENDING`. The [sanitized evidence](evidence/toolkit-sandbox-journey.json) records the calls and re-reads. Pending is not a completed refund, so completion remains unverified.

A second independent run through the same command produced completed sandbox capture `26H95788NP611400W` and refund `4XX50573PL434000M` in `PENDING` status. The repeat call was blocked by the gateway. The SDK, gateway and provider path worked for this controlled scenario; the refund's completion remains unverified.
