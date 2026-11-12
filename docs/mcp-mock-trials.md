# Run a trial with an MCP agent host

Still can give an agent host an isolated MCP connection for each mock trial, before any permission is issued. The host must already know how to start its agent with a scenario and connect it to the provided MCP client. This is an integration API, not automatic compatibility with an arbitrary unchanged agent.

Run the scripted MCP example from the repository root (Node.js 22 or later):

```sh
mkdir -p /tmp/still-mcp-deps
npm install --prefix /tmp/still-mcp-deps @paypal/agent-toolkit@1.11.0 @modelcontextprotocol/sdk@1.32.2
STILL_TOOLKIT_INSTALL=/tmp/still-mcp-deps node examples/mcp-trial-agent.mjs
```

The example runs 10 synthetic personas five times each and prints the actual recorded mock calls, check results, and aggregate scores. `STILL_AGENT_MODE=unsafe` runs its deliberately unsafe script and exits nonzero when checks fail. `STILL_PERSONAS` and `STILL_TRIALS` change the run size. This example is scripted; it does not demonstrate model reasoning or PayPal behavior.

The CLI accepts an importable host module:

```sh
STILL_TOOLKIT_INSTALL=/tmp/still-mcp-deps node bin/still.mjs test \
  --agent mcp --agent-module examples/mcp-scripted-host.mjs --personas 1000 --trials 5
```

The module exports `sdk`, `toolkit` and `runAgent` as described below. It executes as local Node.js code, so use only a host you trust. Still routes calls through its supplied MCP client to the mock; it does not confine the host or prevent it from making other network calls. A displayed `mcp-local-...` ID identifies the module path on that machine, not its contents or a verified agent identity. The GitHub Action accepts the same choice as `agent: mcp` and `agent-module: path/to/host.mjs`; install host dependencies before that step. Paths resolve from the current working directory.

`examples/mcp-codex-host.mjs` is an optional model-backed host using the local signed-in Codex CLI to choose each action. It uses the same mock tools and needs `STILL_TOOLKIT_INSTALL`. Model availability and authentication are required; an unavailable or incomplete model run fails the gate as unverified. It does not prove a PayPal sandbox outcome.

To use a trusted MCP host in the app, start Still with the module configured by the operator, then select **Configured local MCP host** on the driving-test page:

```sh
STILL_TOOLKIT_INSTALL=/tmp/still-mcp-deps STILL_MCP_AGENT_MODULE=examples/mcp-codex-host.mjs npm start
```

The module is loaded as trusted Node.js code at server startup. Do not point it at an untrusted file. The browser cannot select or change the module. Start a model-backed host with one persona and one trial; each decision can use a model call. A fully passing batch can request a USD mock permission if its refund evidence includes an explicit decision ID, order lookup and complete dispute check. The workspace can then run that host against a fresh mock gateway. It can also run a separate scripted over-limit and eligible-refund demonstration.

After requesting a mock permission, select **Record agent session** to run the configured MCP host through a fresh mock gateway. A completed, nonempty session can be promoted. Promotion saves its calls and outcomes and compares their replay on a fresh mock. **Rerun the MCP agent** starts the agent again and compares its decisions and gateway results with the recording. Decision IDs may differ between sessions; the comparison checks their reuse pattern within each session. Changed decisions are reported as changed; incomplete runs are unverified. The local session and regression are stored in `.data/mcp-shadow/`. After a page reload, **Open last MCP session** reopens the most recent session in the same browser and running server. They are mock-only and are not a portable CLI regression.

The issuing server checks that it is still running the same loaded host and that the configured module file has not changed. Restarting Still or changing that file requires a new batch. This check does not authenticate the agent, detect changes to imported dependencies or confine its code. PayPal sandbox replay is not available for MCP host runs. Mock results are not PayPal evidence.

To integrate a host, import `createMcpTrialAgent` from `server/mcp-trial-agent.mjs` and pass the resulting function as `agent` to `runTrials`. Provide the SDK's `Server`, `Client`, `InMemoryTransport`, `ListToolsRequestSchema`, and `CallToolRequestSchema`, a `PayPalAgentToolkit` configured with supported actions, and an async `runAgent` callback. Still invokes that callback once per scenario with `client`, `customerRequest`, synthetic `orderId`, and `policy`. The host must start its agent for that scenario, let it discover and call the supplied MCP tools, then return its final customer-facing text. The example shows the callback and complete setup.

For a refund, the host may supply its agent-selected application decision ID as `_meta.stillRequestId` in `client.callTool`. This is separate from PayPal toolkit arguments; reuse it only for a retry of the same refund. Still routes supported calls to the scenario's mock ledger and records them for its deterministic checks. A synthetic confirmation tool is available only when the scenario requires a follow-up. Every trial has a separate MCP session and ledger; the adapter does not call PayPal or issue an earned permission. A host error or incomplete response is unverified. Provider behavior requires separate real sandbox evidence.
