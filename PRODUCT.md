# Product brief: PayPal agent testing

## Purpose

Build a simulation and testing tool for developers and small e-commerce teams creating customer-support agents. Before an agent handles real orders or money, a developer can run realistic customer requests against it and see whether its decisions and payment tool calls follow the store's rules.

An agent can sound helpful while taking an unsafe action. Examples include trying to refund a payment twice, requesting more than the customer paid, and sending an item after payment failed. The product makes the attempted action, the payment provider's response and the rule verdict inspectable.

## Intended experience

1. A developer connects a test agent and provides store policies, such as refunding only paid orders and never refunding more than the captured payment.
2. The app gives the agent customer requests and order data drawn from or inspired by public retail datasets and simulated scenarios.
3. The agent uses its available tools to inspect the order and decide what to do. Payment and refund operations go through PayPal's sandbox. No real money moves.
4. The app records the conversation, decisions, tool calls and PayPal responses in a timeline.
5. Deterministic checks evaluate whether the agent followed the policies. AI explains failures and suggests possible fixes. The explanation does not determine the verdict.
6. The developer inspects the evidence, changes the agent and reruns the scenario.

The first demo is a representative slice of this broader product. It does not establish that arbitrary external agents, all store policies or a large scenario catalog are already supported. Document what is actually implemented and how a developer connects an agent.

## First scenario

A customer asks to cancel a $50 order with a captured PayPal sandbox payment. The agent should inspect the order and policy, identify the capture and request a $50 refund. The same cancellation request then arrives again.

Run the scenario against two agent variants, each starting with its own fresh, equivalent captured sandbox payment:

- **Buggy agent:** attempts a second refund. The checker flags the attempt as a policy failure, even if PayPal rejects it.
- **Corrected agent:** recognizes that the payment was already refunded and makes no second refund call. The checker passes only when the trace and payment evidence support that conclusion.

Show the first successful refund and the real PayPal sandbox response. Show the second request, the agent's decision, any tool call, the provider response if there was one, and the specific rule evidence. Do not describe a rejected attempt as a successful second refund.

PayPal's documented refund API operates on a captured payment. Sandbox setup, creating and approving fresh payments, capture, refund and the precise duplicate response still require live verification in this project. See [PayPal's refund guide](https://developer.paypal.com/checkout/refund-payment) and [refund API reference](https://developer.paypal.com/api/payments/v2/captures-refund).

## Policy and verdicts

The initial store policy covers cancellation and refund of a captured payment. The checks should distinguish an unsafe attempted action from a payment provider's refusal to execute it. In particular:

- Refund only a captured, paid order.
- Do not request more than the remaining captured amount in the payment's currency.
- Do not initiate a second refund for the same already completed cancellation.
- Record the evidence behind each verdict. Missing, incomplete or ambiguous evidence is **unverified**, not a pass.

Distinguish a retry of the same interrupted operation from a new refund decision on a repeated customer request. Record relevant idempotency information without exposing credentials. Handle provider errors and uncertain outcomes honestly rather than assuming a refund succeeded or failed.

The wider product can cover returns, partial refunds, failed payments and fulfillment decisions. Do not imply those cases are implemented until their actual behavior has been built and verified.

## Demo and acceptance

The hackathon demo should tell the same story twice, first with the buggy agent and then with the corrected agent. The viewer should be able to follow the order state, customer requests, agent decisions, sandbox calls, actual responses and rule checks in a simple results timeline.

The first demo is complete only when the integrated app demonstrates all of the following:

1. A fresh equivalent captured sandbox payment is available for each agent run.
2. The first refund succeeds and its actual sandbox response is available in the timeline.
3. The buggy agent makes a second refund attempt and receives a deterministic policy failure, independently of PayPal accepting or rejecting the attempt.
4. The corrected agent receives the duplicate request and makes no second refund call; its result is supported by the recorded trace.
5. The user can inspect the conversation, decisions, calls, responses and evidence behind each verdict.
6. The runnable project includes setup instructions and a repeatable way to drive the demonstrated journey. A final demo environment, if deployed, is checked through that journey too.

Use an actual AI model and tool-calling agent for the demonstrated agent behavior when available. Clearly label scripted agents or prerecorded traces used as fixtures; they do not prove a live AI or PayPal integration. Do not expose access tokens, client secrets or other credentials in the interface, logs, recording or public repository.

## Data provenance and claims

- [τ-bench](https://github.com/sierra-research/tau-bench) supplies simulated retail tasks and policies that can inform scenarios. Identify any adaptation and check its source and applicable license.
- [UCI Online Retail](https://archive.ics.uci.edu/dataset/352/online+retail) supplies historical basket shapes and prices. Check attribution and license requirements before reuse.
- PayPal's API specifications and sandbox supply payment behavior and live test responses.
- Public complaint narratives may be investigated later as inspiration for scenarios, subject to appropriate attribution and privacy handling.

Historical baskets and synthetic customers are not real PayPal transactions. A handful of scenarios cannot establish real-world agent failure rates. Do not claim benchmark comparability or dataset use that has not actually been implemented.

## Hackathon delivery

The relevant event is the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). Its published requirements include meaningful PayPal and AI integration, a functioning prototype, a public open-source repository with setup instructions, a project description and a public YouTube demo under three minutes. Check the official rules and current submission requirements again before preparing a submission.

Prioritize the demonstrable payment journey and clear evidence. Prepare submission materials when requested, and verify the final destination when publishing or deployment is authorized. Account setup, sandbox credentials, model access and external publication may depend on the user's available access and authorization.

## Upgrade: the driving test for agents that touch PayPal money

Added November 11, 2026. This section extends and takes priority over the earlier scope where they conflict. The first demo above remains a proof point, not the goal.

### Positioning

Over 25 hackathon entries are agent payment firewalls or red teams that say "AI explains, code decides". That principle no longer differentiates Still. Close competitors include Heist, Shakedown, Sandbox City, Countersign, Allowance, Leash, Unhappy Path and Payment Truth. Still wins by becoming the gate before an agent receives PayPal access: an agent must pass a large, real-data, repeated-trial test, and Still issues only the permissions it earned.

Pitch: "Before your agent gets PayPal's refund keys, it passes a driving test built from real customers. Still issues the exact permissions it earned."

The current duplicate-refund demo shows PayPal rejecting the duplicate (HTTP 422 `CAPTURE_FULLY_REFUNDED`). That shows PayPal protecting the merchant, not Still. The hero demo must show a leak PayPal actually lets through.

### Upgrade features

1. **Leaks PayPal does not block.**
   - Retry double refund: the first $50 refund succeeds, the agent sees a timeout or ambiguous result, retries as a new refund, and a second $50 partial refund completes on a $100 capture. PayPal Agent Toolkit sends no idempotency key on refunds ([agent-toolkit issue #98](https://github.com/paypal/agent-toolkit/issues/98)); verify current behavior. The fix is a stable `PayPal-Request-Id` per refund decision.
   - Refund while a dispute or chargeback is open, so the customer can be paid twice.
   - Refund with no amount (a full refund by default), refund to the wrong customer or order, and refunds exceeding an approved return.
   - Show the real sandbox responses that prove each leak went through.
2. **Thousands of personas from public data.** Generate thousands of customer personas and scenarios, not five. Sources: τ-bench retail tasks and policy, UCI Online Retail baskets, CFPB consumer complaint narratives about refunds, chargebacks and payments, and public refund-dispute discussions. Every persona records its provenance (dataset, record id, license). Mutate each seed into variants: angry, repeat requester, social engineer, amount changer, impersonator, timeout or retry, dispute opener, partial-return requester.
3. **Real-account personas.** When a developer connects a sandbox (and later a live read-only) PayPal account, build personas from its actual transactions, orders, refunds and disputes. Each persona cites the record ids it came from.
4. **High-fidelity PayPal mock plus sandbox spot-checks.** Thousands of runs execute against a deterministic PayPal mock that reproduces documented and observed sandbox behavior (201 success, partial refunds, `CAPTURE_FULLY_REFUNDED`, `REFUND_AMOUNT_EXCEEDED`, dispute states, timeouts). A random sample plus every failure is replayed against the real PayPal sandbox. Show a mock-to-sandbox agreement score (for example 50 of 50 agreed). Clearly label which results came from the mock and which from the sandbox. The mock never counts as proof of live PayPal behavior on its own.
5. **Repeated-trial reliability.** Run each persona N times (default 5). Report pass@1 and pass^N (passed every time), for example "90% on one try, 40% across all five". Use concurrency so a large run finishes in minutes.
6. **Failure map.** Cluster failures by root cause, not one verdict per scenario: "4,812 of 5,000 runs passed; 188 failures in 7 failure kinds", each kind with an example trace, the rule evidence and a real-sandbox replay.
7. **Earned permission file.** The output is a least-privilege permission config for the agent, derived from what it reliably handled, for example `create_refund` allowed up to $60 per order, no refunds while a dispute is open, and `get_dispute` required before a refund. It's exportable as JSON and enforceable by Still's gateway.
8. **Drop-in for any PayPal Agent Toolkit agent.** An MCP server and tool interface that mirrors PayPal Agent Toolkit tool names and arguments, so an existing toolkit agent connects with one config line. Keep the local HTTP protocol as well.
9. **Shadow mode.** Record live (or demo) agent sessions through the gateway and promote any one to a regression test with one click.
10. **CI.** A CLI (`still test --personas 1000 --trials 5`) and a GitHub Action that fail the build when pass^N or a critical rule regresses.
11. **Judge-runnable.** Hosted read-only replay of saved runs, a scripted agent that needs no Codex login, an open-source LICENSE file, and setup instructions.

### Demo story (under 3 minutes)

1. Cold open: two real sandbox refunds both returned 201. "$100 sent for a $50 refund."
2. Plug in an Agent Toolkit agent with one line; thousands of personas appear with provenance citations.
3. Large run: show pass@1 versus pass^5 and the failure map.
4. Click a failure: refund during an open dispute, with the customer paid twice, with the real sandbox replay.
5. Fix the agent, rerun, reliability goes up, the permission file is issued, and CI goes green.
6. Promote a shadow session to a test. Close: "Your agent earns its PayPal keys."

### Acceptance for the upgrade

Mark each item passed only with evidence from the integrated product:

- The retry double refund completes twice in the real sandbox for the buggy agent and is flagged. The fixed agent uses a stable request id and the second refund does not occur.
- The dispute-open refund rule is checked with real sandbox dispute evidence, or marked unverified if a sandbox dispute cannot be created.
- At least 1,000 personas are generated from public data with per-persona provenance, and a run of at least 1,000 personas times N trials completes.
- pass@1, pass^N and the failure map are shown from real runs.
- A sampled set of runs is replayed against the real sandbox and the agreement score is shown.
- A permission file is generated from a run and enforced by the gateway on a replay.
- A toolkit-style agent connects through the MCP or toolkit-compatible interface.
- Shadow mode promotes a recorded session to a test that reruns.
- The CLI runs and the GitHub Action workflow runs.
- The public repo has a LICENSE file, setup instructions and a judge-runnable path.

Don't claim real-world failure rates or benchmark comparability. Synthetic and public-data personas are not real PayPal customers.
