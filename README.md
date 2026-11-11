# Still

Still is a prototype for testing online-store support agents against payment policies. It records agent decisions, sandbox tool calls and PayPal responses so a developer can inspect a cancellation followed by a duplicate refund request.

**Status:** The first scenario has been exercised end to end with Codex and PayPal sandbox using separate $50 USD captures. This project is a local prototype, not a production payment integration.

## Run locally

Use Node.js 22 or later and an installed Codex CLI signed in with ChatGPT. Copy `.env.example` to `.env` and set:

- `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from a PayPal **sandbox** REST app.
- `CODEX_MODEL` defaults to `gpt-6.1-terra`. The local runner uses the signed-in Codex CLI to propose agent actions. The application executes the PayPal sandbox calls itself.
- `PORT` if port 3000 is unavailable.

Start with `npm start` and open `http://127.0.0.1:3000`. Alternatively, enter the PayPal sandbox credentials at `http://127.0.0.1:3000/setup` after starting the server; this keeps them in memory only until the server stops. Choose an agent, create a sandbox order, approve it using a PayPal sandbox buyer, return to capture it, and run the scenario. Create a new order for each agent. Only PayPal sandbox endpoints are used. Credentials remain on the server and `.env` is excluded from Git.

The app binds to localhost. Pending orders stay in memory and are cleared on restart. Completed run traces are saved locally under `.data/runs/`, which is excluded from Git. Do not expose the app to the internet as-is. Codex usage is subject to your account's plan and limits.

## What the verdict means

The intentionally buggy agent loses its prior conversation and sees an empty refund history on each request. The corrected agent keeps its conversation and can inspect refund history. Both use a real model and the same tool interface; neither outcome is guaranteed. The application records calls before PayPal responds so an unsafe attempted duplicate can be flagged even when PayPal rejects it. Deterministic checks decide the verdict. A missing provider response or incomplete agent run is inconclusive. AI-generated explanations do not change the verdict.

The demo runs one hand-authored scenario. It does not yet import τ-bench or UCI Online Retail data, connect arbitrary external agents, or estimate real-world failure rates. See [PRODUCT.md](PRODUCT.md) for the wider product vision and acceptance criteria.

## Verified demo

On November 11, 2026, the buggy agent received a completed $50 sandbox capture, issued a completed $50 refund, and attempted another $50 refund on the duplicate request. PayPal rejected the second request with HTTP 422 and `CAPTURE_FULLY_REFUNDED`; the fixed amount and duplicate checks failed. On a separate fresh capture, the corrected agent issued a completed $50 refund, recognized the duplicate request, and made no second refund call; all four checks passed. Both runs used the signed-in Codex CLI with `gpt-6.1-terra`. Their full sanitized traces remain in the local run history, not in the public repository.

Model behavior can vary. For a new demonstration, inspect the customer requests, agent messages, tool calls, PayPal responses and policy checks for each run. A model or sandbox failure is an unverified run, not a pass.
