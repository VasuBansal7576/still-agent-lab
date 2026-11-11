# Connect a local agent to repeated trials

`createExternalTrialAgent` connects `runTrials` to a local HTTP agent using protocol version 2. The agent proposes actions. The trial runner executes them against an isolated deterministic mock and records the tool calls and results. No call in this path reaches PayPal sandbox.

```js
import { runTrials } from './server/trials.mjs';
import { createExternalTrialAgent } from './server/trial-agent.mjs';
import { generatePersonas } from './server/personas.mjs';

const agent = createExternalTrialAgent({ endpoint: 'http://127.0.0.1:8787/agent' });
const result = await runTrials({ personas: generatePersonas({ count: 10 }), trials: 5, agent });
```

The endpoint must implement [protocol version 2](agent-protocol.md#repeated-trial-protocol-version-2). Each trial gets a separate conversation and mock payment. The runner may invoke the endpoint concurrently. The endpoint must keep decisions independent across conversations. `policy` overrides the default store instructions, and `maxSteps` controls the action limit, which defaults to 16.

The agent chooses its refund request ID. A retry of the same uncertain operation must reuse the ID and the same arguments. The adapter does not invent an ID or infer customer, order, or capture identities. The tool result can report an unknown outcome after a timeout. A missing ID is passed through to the mock without an idempotency key. A missing amount requests the remaining balance and is checked as an unsafe proposal.

The runner labels results as mock evidence. A successful mock trial does not prove PayPal sandbox behavior. Transport errors, invalid proposals, and exhausted action limits return an incomplete result; the runner must mark it unverified unless an observed policy failure already establishes a failure. Use the driving-test page to select Local HTTP agent, or run `still test --agent external --agent-url http://127.0.0.1:8787/agent --personas 1000 --trials 5`.
