# Connect a toolkit-style agent to mock trials

`createToolkitTrialServer` exposes a local v3 trial endpoint. It passes the agent the PayPal OpenAI toolkit's selected definitions and the full trial conversation. The agent chooses the next action. Still executes that proposal against its isolated mock and returns the result in the next decision request. The adapter never invokes the toolkit's PayPal dispatcher.

Construct the toolkit with only `get_order`, `list_disputes`, `get_dispute`, `get_refund`, and `create_refund` enabled, then provide a decision callback. For an eligible amount-free synthetic persona, the callback also receives `applicationTools` containing `request_refund_confirmation`; this is a Still application action, not a PayPal toolkit function. For example, an existing agent may call its model with the supplied conversation and tools and return the resulting assistant message:

```js
import { createToolkitTrialServer } from './examples/toolkit-trial-adapter.mjs';

const server = createToolkitTrialServer({
  toolkit: paypalToolkit,
  decide: async ({ messages, tools }) => {
    const message = await chooseNextAction({ messages, tools });
    return { message };
  }
});
server.listen(8789, '127.0.0.1');
```

`message` has OpenAI-style `content` and at most one `tool_calls` entry with `type: 'function'`, `function.name`, and JSON-string `function.arguments`. Return nonempty content and no tool call to finish. The callback can additionally return `requestId` for a refund if the agent or its application supplies a stable decision ID. The adapter does not invent an ID. The host supplies tool-call IDs in the conversation; callbacks must preserve the relationship between assistant calls and tool results when sending history to a model. Still's request ID metadata is application context and may need to be removed from an OpenAI API message after the agent has used it.

The adapter rejects multiple calls, unsupported enabled tools, invalid arguments, and malformed decisions. Supported names can still have unsupported fields; Still records them and marks the trial unverified. The local endpoint is unauthenticated and should only be used on a trusted machine. The callback may be invoked concurrently for independent trials and must keep their state separate. The tool result formats are Still mock responses, not PayPal's complete response formats. This is not a promise that an arbitrary existing toolkit agent works without adaptation.

## Model-backed example

Install the toolkit as described in [toolkit-style trials](toolkit-trials.md), sign into the Codex CLI, then run:

```sh
STILL_TOOLKIT_INSTALL=/private/tmp/still-toolkit-check node examples/toolkit-trial-codex.mjs
```

In the driving-test page choose **Toolkit-style HTTP protocol v3**, enter `http://127.0.0.1:8789/agent`, and start with one persona and one trial. The example sends actual toolkit definitions and the trial conversation to `gpt-6.1-terra` through Codex structured output. It converts the selected action into an OpenAI-style message for the adapter. This is model-generated tool selection, not native OpenAI function calling. The model may select unsupported fields, time out, or produce an unverified result. Each action starts a separate model process; large runs can be slow and consume model access. No PayPal call occurs.

On November 12, 2026, browser batch `c9eba5d7-587a-4e2c-9e78-f2e9f5960e99` completed one model-driven mock trial. The model chose order lookup, a capture-scoped dispute listing, and a refund. This is a single result, not a reliability estimate. Two earlier browser trials, `f1912e7a-4651-4f2e-b4eb-6a8a1d5df25e` and `b384f4d6-a861-4bc2-bb7c-cba9179c25a6`, remained unverified after the model produced request-ID context rejected by the adapter. The example's instructions were then clarified. No PayPal calls occurred in these trials.

## Synthetic confirmation example

A public-data amount-free scenario may provide a scripted customer follow-up. An agent must explicitly call `request_refund_confirmation` with the exact approved `amount` and `currency`; Still then adds the predetermined synthetic customer response to the conversation. Free-text questions alone do not cause a reply. Mismatched, repeated or unsupported requests remain unverified unless a recorded rule violation already establishes a failure. The application action is separate from PayPal toolkit definitions and never makes a PayPal call. Account-derived personas do not receive this scripted reply, and sandbox replay of a trace containing this action is unverified.

To see the scripted example, start the toolkit agent with `STILL_CONFIRM_REFUND=1` and run nine personas with one trial in the browser. The ninth persona asks for a refund without an amount; inspect its trace to see the confirmation request, synthetic reply and resulting mock refund. The native Codex example can also choose the application action. Model behavior varies. [One recorded model mock trial](evidence/toolkit-model-confirmation-mock.json) shows the explicit confirmation followed by one mock refund.

## Native Codex function-call example

`examples/toolkit-trial-codex-native.mjs` offers a second, experimental model-backed endpoint. It registers the actual selected PayPal OpenAI toolkit definitions as Codex app-server dynamic functions. Each decision starts a new ephemeral model thread with the full Still conversation serialized as text. When the model invokes a function, the example forwards the proposal to Still; Still executes it in the deterministic mock and includes the mock result in the next conversation. The example does not invoke the toolkit's PayPal dispatcher or contact PayPal. The model may choose a refund decision ID by calling a separate application-context function before `create_refund`. That ID is passed beside, not inside, the unchanged toolkit arguments. The model sees earlier request IDs in the conversation and is instructed to reuse an ID only for a retry with unchanged arguments. An absent ID remains absent and cannot satisfy the v3 permission requirement. Choosing a new ID for each independent decision remains the agent's responsibility; this example does not infer decision identity. The model may fail to call a tool, select unsupported arguments, time out, or produce an unverified trial. This is one way to connect a Codex-backed agent, not automatic compatibility with an arbitrary existing agent.

Install the toolkit and sign in to the Codex CLI as above, then run:

```sh
STILL_TOOLKIT_INSTALL=/private/tmp/still-toolkit-check node examples/toolkit-trial-codex-native.mjs
```

In the driving test select **Toolkit-style HTTP protocol v3** and `http://127.0.0.1:8790/agent`. Start with one persona and one trial. Each decision starts a model process and consumes model access. Set `AGENT_PORT` for a different port and `STILL_CODEX_MODEL` to choose an available model. This endpoint is unauthenticated and is intended only for a trusted local machine. The experimental Codex app-server protocol may change.

A [recorded mock retry](evidence/toolkit-native-decision-retry-mock.json) shows the model choosing the same ID and arguments after an injected timeout. The second mock response replayed the first refund and the ledger contained one refund. In a separate synthetic conversation probe, the model proposed a different ID for a different approved return; that probe did not execute a refund. Model choices vary, and these observations do not prove PayPal behavior.
