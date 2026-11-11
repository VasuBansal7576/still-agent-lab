# Still

Still lets developers run retail support agents through customer requests and inspect their decisions, tool calls, payment responses, and policy checks. The app uses PayPal sandbox for captured payments and refunds. Order cancellations, failed payments, and fulfillment actions are simulated and labeled in the timeline.

Still is a local prototype. It supports one local HTTP agent protocol and five scenarios. It is not a production payment integration or a measure of real-world failure rates.

## Start the lab

Use Node.js 22 or later and a Codex CLI signed in with ChatGPT. Start the server with `npm start` and open [the local lab](http://127.0.0.1:3000). Set `PORT` before launch to use a different port.

For captured-payment scenarios, create a PayPal sandbox REST app linked to a compatible sandbox business account. Enter its client ID and secret at `http://127.0.0.1:3000/setup`. They remain in server memory until it stops. Alternatively, copy `.env.example` to `.env` and enter the credentials there. Never use live credentials. US sandbox buyer and seller accounts support the $50 USD example. The app communicates only with PayPal sandbox.

Choose a scenario and agent. For a captured-payment scenario, create a sandbox order, approve it with the sandbox buyer, return to Still, and capture it. Run the agent. Each run needs a fresh captured payment. For a failed-payment scenario, run directly without a sandbox capture.

The built-in buggy and corrected agents use the signed-in Codex CLI. `CODEX_MODEL` defaults to `gpt-6.1-terra`. Codex usage is subject to your account's plan and limits.

## Connect an agent

Run an agent that implements the [local agent protocol](docs/agent-protocol.md). Select **Your agent** and enter its loopback HTTP endpoint. Still sends the conversation and supported tool names. The agent proposes an action, and Still executes it and returns the result in the next request. Still does not give the agent PayPal credentials.

To try an AI-backed agent using your signed-in Codex CLI, run `node examples/codex-agent.mjs` in another terminal and use `http://127.0.0.1:8787/agent`. `node examples/agent.mjs` is a scripted protocol example, not an AI agent. Set `AGENT_PORT` to change either example's port.

## Scenarios and results

The catalog includes repeated cancellation, a request for more than the captured amount, a partial return, a refund request after failed payment, and a shipping request after failed payment. The basket shape is adapted from UCI Online Retail. Customer requests, USD prices, order cancellation, payment failures, and fulfillment are synthetic. See [data and sources](DATA.md).

Choose which applicable rules to send to the agent and check. At least one rule must be enabled. Fixed checks cover simulated cancellation, captured payment, remaining refund amount and currency, duplicate refund attempts, approved return amount, and fulfillment after failed payment where applicable. Disabled rules are labeled in the results and excluded from the verdict. Additional free-text policies are not automatically evaluated. The timeline records actions before provider responses, so an unsafe attempt can fail even when PayPal rejects it. Missing evidence produces an inconclusive result. AI explanations do not decide the verdict.

Runs are stored locally in `.data/runs/` and shown in history. New runs include their effective policy, selected checks, scenario snapshot, model or local agent origin, and implementation fingerprints. Older runs may not contain these details. A pending checkout is restored after a page reload in the same browser session. Start over is available before capture only after PayPal confirms the order state. If capture is uncertain, check its status before proceeding. Pending payments and in-memory credentials are lost on server restart; consult PayPal before trying again after an interruption. The server binds to localhost. Do not expose it to the internet as-is.

## Demonstrated behavior

On November 11, 2026, the original duplicate-cancellation demo ran with GPT-6.1 Terra and separate PayPal sandbox captures. PayPal completed the buggy agent's first $50 refund and rejected its duplicate with HTTP 422 and `CAPTURE_FULLY_REFUNDED`. The checker flagged the duplicate attempt. On another capture, the corrected agent made one completed refund and no second refund call. The saved timelines record both outcomes.

The expanded catalog was exercised with PayPal sandbox. A connected GPT-6.1 Terra agent canceled the simulated order, made one completed $50 sandbox refund, and did not repeat it. On a separate capture, the buggy agent canceled the simulated order, completed the first refund, and attempted a duplicate. PayPal rejected the duplicate and Still flagged it. A scripted unsafe agent attempted a $60 refund against a $50 capture; PayPal rejected it with `REFUND_AMOUNT_EXCEEDED` and Still flagged the attempt. A $20 partial-return refund also completed in the sandbox. Failed-payment and fulfillment scenarios use simulated state. Model behavior can vary between runs.

## Driving test upgrade

Open `/upgrade` in the running app for mock trials, failure clusters, permission export and a shadow regression example. Run `node bin/still.mjs test --personas 1000 --trials 5` without a Codex login; [CLI instructions](docs/cli.md) include connecting a local HTTP agent. [Hosted read-only sandbox replay](https://still-sandbox-replay-vasu.zippy17.chatgpt.site) shows earlier $50 traces. See [upgrade acceptance evidence](docs/upgrade-acceptance.md) for what has and has not been verified.
