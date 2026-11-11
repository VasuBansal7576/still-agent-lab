# Still

Still is a prototype for testing online-store support agents against payment policies. It records agent decisions, sandbox tool calls and PayPal responses so a developer can inspect a cancellation followed by a duplicate refund request.

**Status:** The live PayPal and AI journey has not yet been verified. The first scenario is implemented for a fresh $50 USD sandbox capture. This project is a local prototype, not a production payment integration.

## Run locally

Use Node.js 22 or later and an installed Codex CLI signed in with ChatGPT. Copy `.env.example` to `.env` and set:

- `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from a PayPal **sandbox** REST app.
- `CODEX_MODEL` defaults to `gpt-6.1-terra`. The local runner uses the signed-in Codex CLI to propose agent actions. The application executes the PayPal sandbox calls itself.
- `PORT` if port 3000 is unavailable.

Start with `npm start` and open `http://127.0.0.1:3000`. Choose an agent, create a sandbox order, approve it using a PayPal sandbox buyer, return to capture it, and run the scenario. Create a new order for each agent. Only PayPal sandbox endpoints are used. Credentials remain on the server and `.env` is excluded from Git.

The app binds to localhost and keeps order state in memory. Restarting clears the current session. Do not expose it to the internet as-is. Codex usage is subject to your account's plan and limits.

## What the verdict means

The intentionally buggy agent loses its prior conversation and sees an empty refund history on each request. The corrected agent keeps its conversation and can inspect refund history. Both use a real model and the same tool interface; neither outcome is guaranteed. The application records calls before PayPal responds so an unsafe attempted duplicate can be flagged even when PayPal rejects it. Deterministic checks decide the verdict. A missing provider response or incomplete agent run is inconclusive. AI-generated explanations do not change the verdict.

The demo runs one hand-authored scenario. It does not yet import τ-bench or UCI Online Retail data, connect arbitrary external agents, or estimate real-world failure rates. See [PRODUCT.md](PRODUCT.md) for the wider product vision and acceptance criteria.

## Evidence required before claiming success

Run both variants on separate fresh captures, then inspect the recorded customer requests, agent messages, tool calls, sanitized PayPal responses and policy checks. The buggy run must show a second refund attempt and a failure. The corrected run must show the duplicate request and no second refund call. A model or sandbox failure is an unverified run, not a pass.
