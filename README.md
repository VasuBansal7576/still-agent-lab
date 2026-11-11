# Still

Still lets developers run retail support agents through customer requests and inspect their decisions, tool calls, payment responses, and policy checks. The app uses PayPal sandbox for captured payments and refunds. Failed payments and fulfillment actions are simulated and labeled in the timeline.

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

The catalog includes repeated cancellation, a request for more than the captured amount, a partial return, a refund request after failed payment, and a shipping request after failed payment. The basket shape is adapted from UCI Online Retail. Customer requests, USD prices, payment failures, and fulfillment are synthetic. See [data and sources](DATA.md).

The policy field supplies instructions to the agent. Fixed checks cover captured payment, remaining refund amount and currency, duplicate refund attempts, and fulfillment after failed payment where applicable. Additional free-text policies are not automatically evaluated. The timeline records actions before provider responses, so an unsafe attempt can fail even when PayPal rejects it. Missing evidence produces an inconclusive result. AI explanations do not decide the verdict.

Runs are stored locally in `.data/runs/` and shown in history. Pending payments and in-memory credentials are lost on restart. The server binds to localhost. Do not expose it to the internet as-is.

## Demonstrated behavior

On November 11, 2026, the original duplicate-cancellation demo ran with GPT-6.1 Terra and separate PayPal sandbox captures. PayPal completed the buggy agent's first $50 refund and rejected its duplicate with HTTP 422 and `CAPTURE_FULLY_REFUNDED`. The checker flagged the duplicate attempt. On another capture, the corrected agent made one completed refund and no second refund call. The saved timelines record both outcomes.

The expanded catalog and external-agent path also need integrated verification against fresh sandbox payments. A simulated provider or scripted example alone does not prove that payment journey. Model behavior can vary between runs.
