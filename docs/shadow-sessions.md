# Shadow sessions

`server/shadow-sessions.mjs` records calls made to an isolated deterministic PayPal mock through the Still gateway. It supports demo clients and local agents. It does not connect to a PayPal account, make sandbox calls, capture a conversation, or prove an agent's reasoning. A replay repeats gateway tool calls rather than rerunning the agent.

## Host API

Import `createShadowSessions` and pass a private local `directory`. The returned methods are asynchronous.

- `create({source, amount, approvedReturn, currency, disputeOpen})` creates a session. `source` is required and is `demo` or `local-agent`. The optional defaults are `100.00`, `50.00`, `USD`, and `false`. Amounts are positive decimal strings with two places. The return value includes `id`, `scenario.orderId`, `captureId`, and `disputeId` for calls.
- `call(id, {name, arguments, decisionId})` sends an actual call to the session's gateway and returns `{result, session}`. Supported tools are `get_order`, `get_dispute`, `get_refund`, and `create_refund`. Use the generated mock identifiers. Refunds require a matching `get_dispute` call and an explicit amount, currency, and decision ID. Use the same decision ID for a retry of one decision. The stored decision ID is a hash of the submitted value.
- `get(id)` reads the persisted session. `list()` returns stored sessions, newest first.
- `promote(id)` stores and returns a regression containing the calls and gateway outcomes recorded so far. An empty session cannot be promoted. Promoting again replaces the regression with the current sequence.
- `replay(id)` runs the promoted calls against a fresh mock and returns `{provenance, sourceSessionId, sessionId, results, events, comparison}`. The comparison is `matched` when every result matches the recorded outcome, `changed` with per-call expected and actual results when it differs, or `unverified` for older regressions that lack complete expected outcomes. Replay does not change the recorded session.

Example for a local agent, after creating a store and session:

```js
const session = await store.create({ source: 'local-agent', amount: '80.00', approvedReturn: '30.00' });
await store.call(session.id, { name: 'get_order', arguments: { order_id: session.scenario.orderId } });
await store.call(session.id, { name: 'get_dispute', arguments: { dispute_id: session.disputeId } });
await store.call(session.id, {
  name: 'create_refund',
  arguments: { capture_id: session.captureId, amount: { value: '30.00', currency_code: 'USD' } },
  decisionId: 'return-17'
});
await store.promote(session.id);
const replay = await store.replay(session.id);
```

The store allows 200 sessions and 100 calls per session. It writes one JSON file per session with private file permissions and restores mock state from the recorded calls after a restart. Calls are serialized within one store instance. Multiple processes must not write to the same directory. The gateway blocks unsafe refunds in shadow mode; shadow mode does not bypass enforcement. Only generated mock identifiers and constrained arguments are accepted. Do not put credentials or customer data in decision IDs. Hashing is not encryption. Protect the directory because amounts and mock traces remain visible.

The driving-test page creates a local-agent mock session and promotes it with one click. The same-origin HTTP endpoint `/api/upgrade/shadow-session` accepts `create`, `call`, `get`, and `promote` actions. The caller retains the browser session cookie and uses the returned session ID. Calls from a different browser session are denied. Both original and replay results have `deterministic-mock` provenance and are not live PayPal evidence.

## Run an external local agent

Start Still and a version 2 local HTTP agent, then use the shadow driver:

```sh
PORT=3001 npm start
AGENT_PORT=8787 node examples/trial-agent.mjs
STILL_URL=http://127.0.0.1:3001 STILL_AGENT_URL=http://127.0.0.1:8787/agent node examples/shadow-agent.mjs
```

The driver creates an isolated mock session and sends the customer request to the separately running agent. The agent chooses each next tool. The driver submits those calls through the gateway using the current session's mock identifiers, returns the tool results to the agent, and promotes and replays the recorded calls. Set `STILL_SHADOW_RECEIPT` to a private file path to save the resulting receipt. Its refund status comes from the mock, not PayPal sandbox. The regression replays recorded calls against a fresh mock; it does not rerun the agent or capture a real customer conversation. Browser promotion is scoped to the browser session that created the recording; this command promotes its own session.

An integrated local HTTP journey on November 12, 2026 created session `shadow-89c4ff6b-5f9e-4f3d-ba31-7d4c15ff77c1` with the scripted agent. It recorded an order lookup, dispute lookup, and mock refund; promotion replayed all three and reported `matched`. A private copy with the expected refund status changed reported `changed` for call 3. A private copy without expected outcomes reported `unverified`. These checks compare mock gateway behavior and do not prove a PayPal response or that the agent would make the same decisions again.
