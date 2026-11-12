# Still

Still lets developers run retail support agents through customer requests and inspect their decisions, tool calls, payment responses, and policy checks. The app uses PayPal sandbox for captured payments and refunds. Order cancellations, failed payments, and fulfillment actions are simulated and labeled in the timeline.

Still is the driving test for agents that touch PayPal money. Its driving test uses synthetic personas, repeated mock trials, failure clusters, and earned mock permissions. It is a prototype, not a production payment integration or a measure of real-world failure rates.

## Start the lab

Use Node.js 22 or later. Start the server with `npm start` and open [the local lab](http://127.0.0.1:3000). Set `PORT` before launch to use a different port. The scripted driving-test agents do not require a Codex login or PayPal credentials for mock trials. AI-backed agents require a signed-in Codex CLI; actual sandbox payments require sandbox credentials.

Clone this repository, run `npm start`, and open `http://127.0.0.1:3000/upgrade`. Connect your local HTTP agent or select a built-in scripted example. Set the number of personas and trials, run the mock trials, inspect individual traces and failure groups, and rerun after changing your agent. A fully passing run can request and exercise a mock-only permission. The scripted examples need no Codex login or PayPal credentials. The [hosted replay](https://vasubansal7576.github.io/still-agent-lab/) shows separate saved PayPal sandbox evidence.

To try a separate scripted HTTP agent without a second terminal, choose **Connect scripted sample agent**, then **Run mock trials**. Open the duplicate-refund failure and choose **Switch to corrected sample and rerun**. Still switches its own example process to corrected behavior; it does not edit your agent. Both runs use the deterministic mock. Stop Still to stop the sample process.

To try a separate HTTP agent, run `STILL_AGENT_MODE=unsafe node examples/trial-agent.mjs` in another terminal. Select **Your local HTTP agent** and enter `http://127.0.0.1:8787/agent`. Stop that process and run `STILL_AGENT_MODE=safe node examples/trial-agent.mjs` to change its behavior at the same address, then rerun. These are scripted examples, not AI agents. Set `AGENT_PORT` if that port is occupied. The advanced lab is at `/lab`; `examples/agent.mjs` uses the older single-scenario protocol instead.

For a model-backed trial, select **Connect Codex model agent** on the driving-test page. This starts the included local Codex agent and sets one persona and one trial. It needs a signed-in Codex CLI and model access; each decision uses model calls and may consume account usage. The agent proposes HTTP tool calls and Still executes them against the mock. An unavailable or incomplete model response is unverified. The endpoint is local and does not authenticate the agent.

For captured-payment scenarios, create a PayPal sandbox REST app linked to a compatible sandbox business account. Enter its client ID and secret at `http://127.0.0.1:3000/setup`. On macOS, Still verifies them with PayPal and saves them in the Mac Keychain so the connection survives a restart. Alternatively, copy `.env.example` to `.env` and enter the credentials there. Never use live credentials. US sandbox buyer and seller accounts support the $50 USD example. The app communicates only with PayPal sandbox.

Choose a scenario and agent. For a captured-payment scenario, create a sandbox order, approve it with the sandbox buyer, return to Still, and capture it. Run the agent. Each run needs a fresh captured payment. For a failed-payment scenario, run directly without a sandbox capture.

The original single-scenario lab's built-in buggy and corrected agents use the signed-in Codex CLI. `CODEX_MODEL` defaults to `gpt-6.1-terra`. Codex usage is subject to your account's plan and limits.

## Connect an agent

Run an agent that implements the [local agent protocol](docs/agent-protocol.md). Select **Your agent** and enter its loopback HTTP endpoint. Still sends the conversation and supported tool names. The agent proposes an action, and Still executes it and returns the result in the next request. Still does not give the agent PayPal credentials.

To try an AI-backed agent using your signed-in Codex CLI, run `node examples/codex-agent.mjs` in another terminal and use `http://127.0.0.1:8787/agent`. `node examples/agent.mjs` is a scripted protocol example, not an AI agent. Set `AGENT_PORT` to change either example's port.

## Scenarios and results

The catalog includes repeated cancellation, a request for more than the captured amount, a partial return, a refund request after failed payment, and a shipping request after failed payment. The basket shape is adapted from UCI Online Retail. Customer requests, USD prices, order cancellation, payment failures, and fulfillment are synthetic. See [data and sources](DATA.md).

Choose which applicable rules to send to the agent and check. At least one rule must be enabled. Fixed checks cover simulated cancellation, captured payment, remaining refund amount and currency, duplicate refund attempts, approved return amount, and fulfillment after failed payment where applicable. Disabled rules are labeled in the results and excluded from the verdict. Additional free-text policies are not automatically evaluated. The timeline records actions before provider responses, so an unsafe attempt can fail even when PayPal rejects it. Missing evidence produces an inconclusive result. AI explanations do not decide the verdict.

Runs are stored locally in `.data/runs/` and shown in history. New runs include their effective policy, selected checks, scenario snapshot, model or local agent origin, and implementation fingerprints. Older runs may not contain these details. A pending checkout is restored after a page reload in the same browser session. Start over is available before capture only after PayPal confirms the order state. If capture is uncertain, check its status before proceeding. Pending payments are lost on server restart; consult PayPal before trying again after an interruption. The server binds to localhost. Do not expose it to the internet as-is.

## Demonstrated behavior

On November 11, 2026, the original duplicate-cancellation demo ran with GPT-6.1 Terra and separate PayPal sandbox captures. PayPal completed the buggy agent's first $50 refund and rejected its duplicate with HTTP 422 and `CAPTURE_FULLY_REFUNDED`. The checker flagged the duplicate attempt. On another capture, the corrected agent made one completed refund and no second refund call. The saved timelines record both outcomes.

The expanded catalog was exercised with PayPal sandbox. A connected GPT-6.1 Terra agent canceled the simulated order, made one completed $50 sandbox refund, and did not repeat it. On a separate capture, the buggy agent canceled the simulated order, completed the first refund, and attempted a duplicate. PayPal rejected the duplicate and Still flagged it. A scripted unsafe agent attempted a $60 refund against a $50 capture; PayPal rejected it with `REFUND_AMOUNT_EXCEEDED` and Still flagged the attempt. A $20 partial-return refund also completed in the sandbox. Failed-payment and fulfillment scenarios use simulated state. Model behavior can vary between runs.

## Driving test upgrade

Open `/upgrade` for connected-agent trials, or `/lab` for advanced controls and the shadow regression example. Additional free-text instructions are sent to an external agent but are not automatically checked, so such runs cannot earn a permission. The endpoint identifies the agent but does not authenticate it. Run `node bin/still.mjs test --personas 1000 --trials 5` without a Codex login; [CLI instructions](docs/cli.md) include connecting a local HTTP agent. [Hosted read-only sandbox replay](https://vasubansal7576.github.io/still-agent-lab/) shows the verified $100 sandbox retry traces. See [upgrade acceptance evidence](docs/upgrade-acceptance.md) for what has and has not been verified.

To use account-derived scenarios, connect a sandbox account at `/setup`, choose **Connected PayPal sandbox account**, select a UTC report range, and import before running. Optional times narrow a busy report. The import is read-only; dispute lookup is optional. Account record IDs and evidence remain in the local batch, while the requests, customer identities, approved returns, and scenario dispute states are synthetic. Reports may be delayed or incomplete. These runs cannot issue a permission because complete account history and dispute coverage are not established.

The workspace can record a session from your local HTTP agent through its passing batch's mock permission. For v2, use the same endpoint address as the passing run. An address does not authenticate the agent. Promote a completed session to replay its recorded gateway calls against a fresh mock. This does not rerun the agent or contact PayPal.

After a qualifying run earns a USD mock permission, **Connect a toolkit agent** shows an MCP stdio configuration for that local batch and the OpenAI toolkit wrapper. The binding supports four selected tools, represents one refund decision per process, and does not authenticate the client or contact PayPal. See [toolkit setup and limits](docs/actual-toolkit.md).

A separate [MCP trial integration](docs/mcp-mock-trials.md) lets a trusted local agent host drive isolated mock trials through the app, CLI or GitHub Action. The host must provide each scenario to its agent and use the supplied MCP client. A Unix stdio bridge also supports agent processes that accept the documented scenario and MCP configuration. A qualifying app batch can earn a mock permission and promote a mock gateway session to a portable CLI regression. Selected traces can be checked for sandbox replay eligibility; actual MCP sandbox replay remains unverified.

An experimental [toolkit-style trial protocol](docs/toolkit-trials.md) lets an adapted local HTTP agent propose selected toolkit-shaped calls during mock trials. The included example uses PayPal toolkit definitions with scripted decisions. Eligible results can earn a mock-only permission and bind selected toolkit tools to the mock gateway. Selected traces can be checked for sandbox replay eligibility; actual PayPal replay of this protocol remains unverified.

An optional [native function-call example](docs/toolkit-trial-adapter.md#native-codex-function-call-example) lets a Codex-backed model choose selected PayPal toolkit functions during mock trials. It needs a signed-in Codex CLI and a separate toolkit installation; it does not send PayPal requests. The model may supply a refund decision ID as application context; a permission still depends on the observed mock evidence.

For the synthetic amount-free scenario, an adapted agent can explicitly request confirmation of the approved amount and receive a predetermined synthetic customer reply. Free-text questions alone remain unverified. See [the toolkit trial setup](docs/toolkit-trial-adapter.md#synthetic-confirmation-example).

The [model-driven gateway example](docs/toolkit-v3-model-gateway.md) uses a qualifying local batch and Codex to choose toolkit calls through that mock binding. The CLI and GitHub Action also accept `agent-protocol: '3'` for an external toolkit-style agent. These paths do not authenticate the agent or call PayPal.

With a qualifying v2 or v3 mock permission open, shadow mode records the connected agent's calls and promotes them to a mock regression. Replay repeats recorded calls; the separate agent rerun invokes the current endpoint against an equivalent mock and reports matched, changed or unverified. The endpoint does not authenticate the agent. See [shadow setup](docs/toolkit-trials.md).

After promotion, **Rerun the connected agent** asks the current v2 or v3 endpoint to make decisions again against a fresh mock and compares its calls and outcomes with the recording. A changed result needs inspection; an unavailable agent is unverified.

You can export a supported v2 or v3 synthetic mock regression and run it with `still regression` or the GitHub Action. The agent is invoked again, and changed or unverified results fail the gate. The export is a mock fixture; its checksum is not an authenticity signature.

To revisit a run after a refresh, open it from **Recent runs** or enter an older batch ID. **Show sandbox coverage** reads that batch's saved immediate replay receipts without making a PayPal request. It reports agreements, disagreements and unverified cases separately; an agreement can include a `PENDING` refund, which is not a completed refund. Saved batches are local to the machine that ran them.

Optional currency-specific limits can cap each refund call, the total refunded per order, or both. Still sends the limits to the agent and checks its mock refund attempts. For an approved return above an applicable limit, a completed session that checks the order and dispute and makes no refund is a passing safety outcome; Still does not check the wording of the response. The saved batch keeps its policy, and a mock permission cannot exceed the checked limits. Other free-text instructions remain unchecked and prevent permission issuance.
