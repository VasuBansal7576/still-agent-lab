# Still GitHub Action

Still supplies a reusable composite GitHub Action for deterministic mock trials. It does not contact PayPal sandbox and does not establish live payment behavior. The gate exits nonzero when any critical policy check fails, any trial is unverified, or the fraction of personas passing every trial is below `min-pass-all`.

For a scripted demonstration, add a step to a workflow:

```yaml
- uses: actions/checkout@v4
- uses: VasuBansal7576/still-agent-lab@main
  id: still
  with:
    personas: '1000'
    trials: '5'
    agent: safe
    min-pass-all: '1'
    max-refund: '100.00'
    refund-currency: USD
```

The action exposes `pass-at-1`, `pass-all-trials`, and `gate` outputs. For an external local HTTP agent, start the agent as a background process in a prior step, then set `agent: external` and `agent-url` to its loopback endpoint. The endpoint receives synthetic customer and order data. The action also accepts `concurrency`, `seed`, and `mock-profile`; `sandbox-test-card` is a modeled stress profile, not a prediction of PayPal responses.

For an external agent using the experimental [toolkit-style trial protocol](toolkit-trials.md), also set `agent-protocol: '3'`. The default is version 2. The equivalent CLI option is `--agent-protocol 3` with `--agent external --agent-url http://127.0.0.1:8788/agent`. The agent must already be running. Version 3 supports selected toolkit-shaped calls against Still's mock; it does not contact PayPal or establish compatibility with every toolkit agent. Unsupported calls and incomplete trials fail the gate as unverified.

The optional `max-refund` input limits each call; `max-order-refund` limits the combined amount per order. Supply `refund-currency` with either or both. They send the app's checked policy to an external agent and include it in the JSON summary. Amounts require two decimal places; currency is a three-letter uppercase code. No currency conversion is performed. The order limit counts committed and pending mock refunds, while an identical retry with the same request ID is not counted twice. If an approved return exceeds an applicable limit, a completed session that checks the order and dispute and makes no refund is an acceptable safety outcome; Still does not check customer-facing wording.

The repository's own [workflow](../.github/workflows/still.yml) uses this same action. Pin the action to an immutable commit in production workflows. The external agent process and its dependencies are owned by the consuming workflow.
