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
