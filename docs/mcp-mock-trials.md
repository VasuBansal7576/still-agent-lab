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

## Connect a subprocess over MCP stdio

The stdio host can start a trusted local agent process for each trial. It gives that process a standard MCP server command for the isolated mock ledger. This still requires an agent launcher that accepts the scenario and server configuration; it does not automatically adapt an unchanged agent. The included subprocess is scripted and makes no PayPal calls.

```sh
STILL_TOOLKIT_INSTALL=/tmp/still-mcp-deps \
STILL_STDIO_AGENT_COMMAND=node \
STILL_STDIO_AGENT_ARGS='["examples/mcp-stdio-scripted-agent.mjs"]' \
node bin/still.mjs test --agent mcp --agent-module examples/mcp-stdio-host.mjs --personas 2 --trials 2
```

For the app, set those same variables and `STILL_MCP_AGENT_MODULE=examples/mcp-stdio-host.mjs` when starting Still, then select **Configured local MCP host**. To see the intentionally unsafe scripted variant, add `"--unsafe"` to `STILL_STDIO_AGENT_ARGS`. Each process receives one JSON object on stdin containing `customerRequest`, `orderId`, `policy`, and `mcpServer` with `command` and `args` for the standard stdio server. It must connect that server, run the scenario, and print exactly one JSON object with a nonempty `answer` on stdout. The mock server closes when the process finishes. The example shows an actual MCP SDK stdio client. The process is trusted local code; Still does not prevent it from contacting other services. A private temporary Unix socket isolates each trial, accepts one connection, and is removed after use. This bridge currently requires Unix-domain sockets and a Node.js runtime for the proxy. An incomplete, unavailable or timed-out process makes the trial unverified. The timeout is 60 seconds by default; set `STILL_STDIO_AGENT_TIMEOUT_MS` from 1000 to 300000 to change it. The child receives `PATH` and `STILL_TOOLKIT_INSTALL`, not the parent process's full environment.

To use a trusted MCP host in the app, start Still with the module configured by the operator, then select **Configured local MCP host** on the driving-test page:

```sh
STILL_TOOLKIT_INSTALL=/tmp/still-mcp-deps STILL_MCP_AGENT_MODULE=examples/mcp-codex-host.mjs npm start
```

The module is loaded as trusted Node.js code at server startup. Do not point it at an untrusted file. The browser cannot select or change the module. Start a model-backed host with one persona and one trial; each decision can use a model call. A fully passing batch can request a USD mock permission if its refund evidence includes an explicit decision ID, order lookup and complete dispute check. The workspace can then run that host against a fresh mock gateway. It can also run a separate scripted over-limit and eligible-refund demonstration.

After requesting a mock permission, select **Record agent session** to run the configured MCP host through a fresh mock gateway. A completed, nonempty session can be promoted. Promotion saves its calls and outcomes and compares their replay on a fresh mock. **Rerun the MCP agent** starts the agent again and compares its decisions and gateway results with the recording. Decision IDs may differ between sessions; the comparison checks their reuse pattern within each session. Changed decisions are reported as changed; incomplete runs are unverified. The local session and regression are stored in `.data/mcp-shadow/`. After a page reload, **Open last MCP session** reopens the most recent session in the same browser and running server.

Select **Export MCP regression** after promotion to download a portable synthetic mock regression. Run it after Still stops:

```sh
STILL_TOOLKIT_INSTALL=/tmp/still-mcp-deps node bin/still.mjs regression \
  --file still-mcp-regression.json --agent-module examples/mcp-scripted-host.mjs
```

The GitHub Action accepts `regression-file` and `agent-module` together after the host dependencies are installed. A changed, unavailable or incomplete host fails the gate. The export contains a synthetic scenario, mock permission and normalized calls, not the agent conversation. Its checksum detects corruption, not intentional modification or agent identity. The local host executes trusted code and is not confined or prevented from making other network calls. Only supported synthetic mock calls can be exported.

The issuing server checks that it is still running the same loaded host and that the configured module file has not changed. Restarting Still or changing that file requires a new batch. This check does not authenticate the agent, detect changes to imported dependencies or confine its code. A selected MCP trace can be checked for sandbox replay eligibility using the same restricted toolkit trace rules as HTTP v3. A replay sends recorded mock calls to a fresh, buyer-approved sandbox capture; it does not rerun the agent. Unsupported traces remain unverified, and actual MCP replay against PayPal has not been verified. Mock results are not PayPal evidence.

To integrate a host, import `createMcpTrialAgent` from `server/mcp-trial-agent.mjs` and pass the resulting function as `agent` to `runTrials`. Provide the SDK's `Server`, `Client`, `InMemoryTransport`, `ListToolsRequestSchema`, and `CallToolRequestSchema`, a `PayPalAgentToolkit` configured with supported actions, and an async `runAgent` callback. Still invokes that callback once per scenario with `client`, `customerRequest`, synthetic `orderId`, and `policy`. The host must start its agent for that scenario, let it discover and call the supplied MCP tools, then return its final customer-facing text. The example shows the callback and complete setup.

For a refund, the host may supply its agent-selected application decision ID as `_meta.stillRequestId` in `client.callTool`. This is separate from PayPal toolkit arguments; reuse it only for a retry of the same refund. Still routes supported calls to the scenario's mock ledger and records them for its deterministic checks. A synthetic confirmation tool is available only when the scenario requires a follow-up. Every trial has a separate MCP session and ledger; the adapter does not call PayPal or issue an earned permission. A host error or incomplete response is unverified. Provider behavior requires separate real sandbox evidence.

Trial and earned-session MCP calls also accept the standard `_meta.progressToken` as a string or integer. It is not a refund decision ID, and Still does not emit progress notifications for these calls. Other metadata remains unsupported. Retries still need the same `stillRequestId`; changing a progress token does not change that decision.
