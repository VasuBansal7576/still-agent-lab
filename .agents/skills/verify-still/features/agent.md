# Connect an agent

A developer connects a loopback HTTP agent and lets Still execute its proposed tools.

## Sub-features

- Connect the AI-backed or scripted example.
- Inspect an agent request and the resulting tool call.

## How to get to it (user POV)

Open the demo and select `Your agent`.

## Driving it with computer use

Preconditions: Start `AGENT_PORT=8789 node examples/codex-agent.mjs` for a real Codex-backed agent. Codex must be signed in.

Choose `Cancel an unpaid order`. Enter `http://127.0.0.1:8789/agent` in `Local agent endpoint`. Choose `Run the agent`. Inspect the order-read call, simulated failed payment, agent response, and verdict. Reopen the run from history.

## Gotchas

The scripted `examples/agent.mjs` is not an AI model. The agent endpoint receives the scenario conversation and must be trusted.
