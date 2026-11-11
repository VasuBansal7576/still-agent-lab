# PayPal Agent Toolkit compatibility

Full compatibility with an actual PayPal Agent Toolkit agent is unverified. PayPal's [toolkit](https://github.com/paypal/agent-toolkit) supplies framework-specific tools and an MCP server. It is not itself an MCP client. An MCP host can choose Still's stdio server in place of PayPal's server. An agent that directly constructs the toolkit's framework-specific tools does not use that MCP configuration and needs an adapter or a change to its tool setup.

Still exposes four tool names: `get_order`, `get_refund`, `get_dispute`, and `create_refund`. PayPal's [refund schema](https://github.com/paypal/agent-toolkit/blob/main/typescript/src/shared/parameters.ts) permits an omitted amount, `invoice_id`, and `note_to_payer`. Still requires an explicit amount and blocks the latter two fields. Other toolkit tools are not implemented. The mock binding requires `get_dispute` before refund and binds one decision ID per process. See [the batch binding](mcp-batch-binding.md) for its setup and trust limits.

## Observed connection

On November 11, 2026, the existing hand-written MCP client connected to a locally saved passing batch with this command:

```sh
node examples/toolkit-client.mjs --batch 34789caa-eabf-43b4-8639-6b51601079e6
```

The server initialized, listed the four tools, returned a clear mock dispute, and returned HTTP 201 with `MOCK-REFUND-batch-1` for a USD 1.00 refund. The repeated call returned the same mock refund ID. The batch is local runtime data, so another checkout must substitute its own qualifying batch UUID. This was a hand-written MCP client, not the PayPal toolkit, an AI agent, or a live PayPal call.

## Pinned toolkit bridge

On November 11, 2026, `@paypal/agent-toolkit` version 1.11.0 was installed in an isolated temporary directory. The following commands repeat the mock check:

```sh
npm install --prefix /private/tmp/still-toolkit-check @paypal/agent-toolkit@1.11.0
STILL_TOOLKIT_INSTALL=/private/tmp/still-toolkit-check node examples/toolkit-sdk-bridge.mjs
```

The example constructs PayPal's actual OpenAI toolkit and obtains its `get_dispute` and `create_refund` tool definitions. An explicit bridge routes scripted OpenAI-shaped tool calls through the official MCP SDK to Still's demo gateway. The gateway returned a clear mock dispute, then HTTP 201 and `MOCK-REFUND-toolkit-1` for a $50 mock refund. A repeated call returned that same mock refund ID. The script checks these results. It does not call an AI model or PayPal, and the toolkit's `handleToolCall` does not execute those calls.

In the installed OpenAI integration, `handleToolCall` dispatches to its own PayPal API client. That client chooses a hard-coded sandbox or production PayPal base URL and exposes no supported Still gateway endpoint setting in its constructor. An existing direct SDK agent must change its dispatch code to use a bridge like this example. The bridge does not establish a one-line drop-in or full toolkit compatibility. It covers two toolkit definitions and Still's disposable mock only. A real AI agent and live PayPal remain unverified.

## Request IDs

The installed 1.11.0 OpenAI package and the current [PayPal client source](https://github.com/paypal/agent-toolkit/blob/main/typescript/src/shared/client.ts) adds `PayPal-Request-Id` when its context has `request_id`. The [reported issue](https://github.com/paypal/agent-toolkit/issues/98) describes the absence of a per-call setting. This source inspection does not prove a live duplicate refund or establish the behavior of every released package version.
