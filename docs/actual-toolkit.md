# PayPal Agent Toolkit compatibility

## Bind an OpenAI toolkit loop during mock trials

Inside an MCP trial host's `runAgent` callback, bind the actual OpenAI toolkit to the supplied per-trial client:

```js
const bound = await connectStillTrialToolkit(paypalToolkit, {
  client,
  refundDecisionId: (call, args) => currentRefundDecisionId(call, args)
});
```

Import `connectStillTrialToolkit` from `examples/still-openai-trial-toolkit.mjs`. The result exposes `getTools()` and `handleToolCall(call)`, so an existing toolkit-style dispatch loop can use the bound object. The host must still start the agent for each synthetic request and provide the current trial's client. The resolver belongs to the agent or host: it must return the same ID only for retries of the same refund decision. Omit it if no decision ID is known; Still will not infer one from tool-call IDs. The binding closes with the trial's client, has no direct PayPal fallback, and supports only the tools exposed by that trial. A host remains trusted local code and is not confined or authenticated.

The included `examples/openai-toolkit-trial-host.mjs` demonstrates the interface with scripted decisions, actual PayPal toolkit definitions and an MCP SDK client. With the dependencies installed as below, run:

```sh
STILL_TOOLKIT_INSTALL=/private/tmp/still-toolkit-check node bin/still.mjs test \
  --agent mcp --agent-module examples/openai-toolkit-trial-host.mjs --personas 9 --trials 2
```

To select the host in the app, start Still with `STILL_MCP_AGENT_MODULE=examples/openai-toolkit-trial-host.mjs` and the same `STILL_TOOLKIT_INSTALL`, then choose **Configured local MCP host**. This is a mock integration, not universal drop-in compatibility, live PayPal dispatch or an AI model demonstration.

Full compatibility with every PayPal Agent Toolkit agent is unverified. PayPal's [toolkit](https://github.com/paypal/agent-toolkit) supplies framework-specific tools and an MCP server. It is not itself an MCP client. An MCP host can choose Still's stdio server in place of PayPal's server. For the OpenAI toolkit, Still also provides a wrapper with the toolkit's `getTools` and `handleToolCall` interface.

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

The example constructs PayPal's actual OpenAI toolkit and obtains its `get_dispute` and `create_refund` tool definitions. The reusable adapter routes scripted OpenAI-shaped tool calls through the official MCP SDK to Still's demo gateway. The gateway returned a clear mock dispute, then HTTP 201 and `MOCK-REFUND-toolkit-1` for a $50 mock refund. A repeated call returned that same mock refund ID. The script checks these results. It does not call an AI model or PayPal, and the toolkit's `handleToolCall` does not execute those calls.

In the installed OpenAI integration, `handleToolCall` dispatches to its own PayPal API client. That client chooses a hard-coded sandbox or production PayPal base URL and exposes no supported Still gateway endpoint setting in its constructor. An existing direct SDK agent must replace its dispatch code with the adapter below. The bridge alone does not establish full toolkit compatibility. The separate binding below provides a one-line wrapper for selected OpenAI toolkit tools. The observed run covers two toolkit definitions and Still's disposable mock only. Live PayPal remains unverified.

## Model-driven mock journey

On November 11, 2026, a Codex subscription run with `gpt-6.1-terra` received the actual toolkit definitions and chose `get_dispute`, then `create_refund`, then a final response. The adapter sent its decisions through the official MCP SDK to Still's disposable mock. The mock returned `CLEAR` and HTTP 201 with `MOCK-REFUND-toolkit-1` for USD 50.00. The final response reported the mock refund. Run it with a logged-in Codex CLI and the pinned toolkit installation above:

```sh
STILL_TOOLKIT_INSTALL=/private/tmp/still-toolkit-check node examples/toolkit-model-codex.mjs
```

The runner uses Codex structured output to propose one action at a time and converts each proposal to an OpenAI-shaped call for the adapter. This is model-generated tool selection, not a native OpenAI function-calling API session. Model choices can vary; the command exits unsuccessfully if the ordered mock journey does not complete. It uses no PayPal credentials and does not prove a live PayPal refund, native toolkit dispatch, or compatibility with every toolkit agent. The Codex CLI needs access to its local app-server and subscription; a restrictive execution sandbox may prevent startup.

## One-line OpenAI toolkit binding

Install `@modelcontextprotocol/sdk` alongside `@paypal/agent-toolkit`, then import `connectStillToolkit` from `examples/still-openai-toolkit.mjs`. After constructing the PayPal OpenAI toolkit, bind it to a passing local batch:

```js
const toolkit = await connectStillToolkit(paypalToolkit, { batchId: 'BATCH-UUID' });
```

Existing code using `toolkit.getTools()` and `await toolkit.handleToolCall(toolCall)` can keep those calls. Close the binding with `await toolkit.close()` when the agent exits. The wrapper starts the batch MCP server and fails closed if an enabled toolkit tool is not supported or if the batch cannot earn a grant. It never falls back to PayPal's direct client. A transport failure rejects the call. This binding uses the batch's disposable mock and a mock-only permission, not sandbox or production PayPal access. It supports only the four tools listed above and is not a promise of compatibility with other toolkit frameworks or versions.

On November 11, 2026, `examples/toolkit-native-journey.mjs` constructed the actual PayPal OpenAI toolkit 1.11.0 and connected it in one binding call to batch `34789caa-eabf-43b4-8639-6b51601079e6`. Its unchanged toolkit-style `getTools` and `handleToolCall` interface listed `get_dispute` and `create_refund`, observed a clear mock dispute and a mock HTTP 201 refund, and observed the same refund ID on retry. The example uses scripted tool calls, not a live model or PayPal response. A separate `gpt-6.1-terra` run using `examples/toolkit-native-model.mjs` chose `get_dispute` and then `create_refund` through the same toolkit-style interface and received a mock HTTP 201. It uses structured model output rather than native OpenAI function calling. Reproduce the scripted journey after the pinned installation above, substituting a qualifying local batch UUID:

```sh
STILL_TOOLKIT_INSTALL=/private/tmp/still-toolkit-check node examples/toolkit-native-journey.mjs BATCH-UUID
```

## Connect an OpenAI toolkit agent with an existing MCP client

Import `createStillToolkitAdapter` from `examples/toolkit-openai-adapter.mjs` and pass it an actual OpenAI toolkit instance and an already connected MCP SDK client. Select only toolkit actions exposed by Still. Binding fails if any configured toolkit tool is unavailable. The adapter does not call the toolkit's `handleToolCall`, which would bypass Still.

For an OpenAI Chat Completions agent, replace its toolkit dispatcher with this pattern. `openai` is an existing OpenAI client, `toolkit` is a configured `PayPalAgentToolkit`, and `client` is connected to the batch binding described in [the batch guide](mcp-batch-binding.md). The caller owns the model choice, initial messages, client lifecycle, and iteration limit.

```js
import { createStillToolkitAdapter } from './examples/toolkit-openai-adapter.mjs';

const adapter = await createStillToolkitAdapter({ toolkit, client });
for (let turn = 0; turn < 10; turn++) {
  const completion = await openai.chat.completions.create({
    model, messages, tools: adapter.tools
  });
  const message = completion.choices[0].message;
  messages.push(message);
  if (!message.tool_calls?.length) break;
  messages.push(...await adapter.dispatch(message.tool_calls));
}
```

The adapter preserves the toolkit's actual OpenAI tool definitions. It validates all calls in a response before dispatching any of them, rejects unsupported or malformed calls, and sends supported calls sequentially through MCP. Successful OpenAI tool-message content is the JSON response body, matching the installed toolkit's `handleToolCall` shape. A gateway denial is returned as an `error` object with type `still_gateway_error`. Malformed or unavailable transport responses reject dispatch. The gateway enforces its own narrower arguments and permissions, and there is no PayPal fallback. Repeated calls represent the same decision only within the binding's documented process lifetime.

On November 12, the earlier wrapper was observed to return a nested MCP envelope where the PayPal toolkit returns a response body. The corrected wrapper was driven through the real toolkit 1.11.0 and MCP SDK: the scripted and `gpt-6.1-terra` journeys read a clear dispute and a completed mock refund directly from `content`, and the scripted retry returned the same mock refund ID. A denied call returned a `still_gateway_error`. These are deterministic mock results, not PayPal sandbox responses; other toolkit frameworks and tools remain unverified.

The pinned bridge uses scripted assistant messages. The separate model-driven mock journey above exercises the same adapter with model-generated decisions. Tool schemas and behavior may change in other toolkit versions.

## Request IDs

The installed 1.11.0 OpenAI package and the current [PayPal client source](https://github.com/paypal/agent-toolkit/blob/main/typescript/src/shared/client.ts) adds `PayPal-Request-Id` when its context has `request_id`. The [reported issue](https://github.com/paypal/agent-toolkit/issues/98) describes the absence of a per-call setting. This source inspection does not prove a live duplicate refund or establish the behavior of every released package version.
