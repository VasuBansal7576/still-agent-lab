---
name: verify-still
description: Verify Still's retail-agent test lab through its browser and PayPal sandbox when changing or validating its user journeys.
---

# Verify Still

Read `AGENTS.md`, `PRODUCT.md`, and `features/README.md`. The user bans unit tests, irrelevant tests, code review, and PR review.

## Launch

Start `PORT=3001 npm start` from the repository. Wait for `Still is available at http://127.0.0.1:3001`. Use another free port if needed. All instances share `.data/runs`; do not run concurrent payment journeys against the same server session. For captured-payment paths, configure a PayPal sandbox REST app at `/setup` or in `.env`. Never copy credentials into evidence.

## Doctor

Open `http://127.0.0.1:3001/`, choose `Explore the demo`, and check the status at the top. Confirm the scenario selector loads. PayPal setup is required only for captured-payment scenarios. For an AI-backed agent, confirm Codex is signed in and the chosen model is available. Read the server output if startup or a run fails.

## Drive and evidence

Use the available computer-use browser on the app. Follow the matching feature recipe in `features/`. Capture the scenario, agent, customer requests, tool calls, provider responses, checks, and final outcome. Reopen each completed run in `Saved runs`; the app stores sanitized records in `.data/runs/`. Copy the relevant record to an evidence directory outside the repository when it must survive cleanup. A mock or synthetic payment is not a PayPal response. If a step cannot be observed, mark it unverified. Checkout state is held in the server session; see [checkout recovery](features/checkout-recovery.md) before interrupting it.

## Cleanup

Stop only the server and example agents started for this verification. Preserve the saved evidence. Do not delete sandbox data or user run history. The app does not isolate run history across ports.
