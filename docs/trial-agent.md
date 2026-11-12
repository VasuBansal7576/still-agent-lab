# Connect a local agent to repeated trials

`createExternalTrialAgent` connects `runTrials` to a local HTTP agent using protocol version 2. The agent proposes actions. The trial runner executes them against an isolated deterministic mock and records the tool calls and results. No call in this path reaches PayPal sandbox.

```js
import { runTrials } from './server/trials.mjs';
import { createExternalTrialAgent } from './server/trial-agent.mjs';
import { generatePersonas } from './server/personas.mjs';

const agent = createExternalTrialAgent({ endpoint: 'http://127.0.0.1:8787/agent' });
const result = await runTrials({ personas: generatePersonas({ count: 10 }), trials: 5, agent });
```

Start the included example with `STILL_AGENT_MODE=unsafe node examples/trial-agent.mjs`, then enter `http://127.0.0.1:8787/agent` on the driving-test page. Stop it and restart with `STILL_AGENT_MODE=safe` to rerun the same endpoint with corrected scripted behavior. The default mode is `safe`. This is a scripted demonstration agent, not an AI model.

For a model-backed agent, sign in to the Codex CLI and start `node examples/codex-agent.mjs`. Use the same endpoint on the driving-test page, or run `node bin/still.mjs test --agent external --agent-url http://127.0.0.1:8787/agent --personas 1 --trials 1 --concurrency 1`. The example requests `gpt-6.1-terra` for each decision. Model access and response time depend on your Codex account and environment. Each decision starts a separate CLI process, so large runs can be slow or exceed account limits. The example binds to loopback without authentication; use it only on a trusted machine. Stop it with Ctrl+C.

The endpoint must implement [protocol version 2](agent-protocol.md#repeated-trial-protocol-version-2). Each trial gets a separate conversation and mock payment. The runner may invoke the endpoint concurrently. The endpoint must keep decisions independent across conversations. In the JavaScript API, `policy` overrides the default store instructions, and `maxSteps` controls the action limit, which defaults to 16. The browser instead appends optional instructions to the standard policy; those instructions are not automatically checked, so the run cannot earn a permission.

The agent chooses its refund request ID. A retry of the same uncertain operation must reuse the ID and the same arguments. The adapter does not invent an ID or infer customer, order, or capture identities. The tool result can report an unknown outcome after a timeout. A missing ID is passed through to the mock without an idempotency key. A missing amount requests the remaining balance and is checked as an unsafe proposal.

The runner labels results as mock evidence. A successful mock trial does not prove PayPal sandbox behavior. Transport errors, invalid proposals, and exhausted action limits return an incomplete result; the runner must mark it unverified unless an observed policy failure already establishes a failure. Use the driving-test page to select Local HTTP agent, or run `still test --agent external --agent-url http://127.0.0.1:8787/agent --personas 1000 --trials 5`.
