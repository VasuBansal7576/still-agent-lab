# Run a trial with an MCP agent host

Still can give an agent host an isolated MCP connection for each mock trial, before any permission is issued. The host must already know how to start its agent with a scenario and connect it to the provided MCP client. This is an integration API, not automatic compatibility with an arbitrary unchanged agent. The existing app's Connect agent screen and `still` CLI do not select this adapter; they use the documented HTTP agent protocol instead.

Run the scripted MCP example from the repository root (Node.js 22 or later):

```sh
mkdir -p /tmp/still-mcp-deps
npm install --prefix /tmp/still-mcp-deps @paypal/agent-toolkit@1.11.0 @modelcontextprotocol/sdk@1.32.2
STILL_TOOLKIT_INSTALL=/tmp/still-mcp-deps node examples/mcp-trial-agent.mjs
```

The example runs 10 synthetic personas five times each and prints the actual recorded mock calls, check results, and aggregate scores. `STILL_AGENT_MODE=unsafe` runs its deliberately unsafe script and exits nonzero when checks fail. `STILL_PERSONAS` and `STILL_TRIALS` change the run size. This example is scripted; it does not demonstrate model reasoning or PayPal behavior.

To integrate a host, import `createMcpTrialAgent` from `server/mcp-trial-agent.mjs` and pass the resulting function as `agent` to `runTrials`. Provide the SDK's `Server`, `Client`, `InMemoryTransport`, `ListToolsRequestSchema`, and `CallToolRequestSchema`, a `PayPalAgentToolkit` configured with supported actions, and an async `runAgent` callback. Still invokes that callback once per scenario with `client`, `customerRequest`, synthetic `orderId`, and `policy`. The host must start its agent for that scenario, let it discover and call the supplied MCP tools, then return its final customer-facing text. The example shows the callback and complete setup.

For a refund, the host may supply its agent-selected application decision ID as `_meta.stillRequestId` in `client.callTool`. This is separate from PayPal toolkit arguments; reuse it only for a retry of the same refund. Still routes supported calls to the scenario's mock ledger and records them for its deterministic checks. A synthetic confirmation tool is available only when the scenario requires a follow-up. Every trial has a separate MCP session and ledger; the adapter does not call PayPal or issue an earned permission. A host error or incomplete response is unverified. Provider behavior requires separate real sandbox evidence.
