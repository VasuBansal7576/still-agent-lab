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
```

The action exposes `pass-at-1`, `pass-all-trials`, and `gate` outputs. For an external local HTTP agent, start the agent as a background process in a prior step, then set `agent: external` and `agent-url` to its loopback endpoint. The endpoint receives synthetic customer and order data. The action also accepts `concurrency`, `seed`, and `mock-profile`; `sandbox-test-card` is a modeled stress profile, not a prediction of PayPal responses.

The repository's own [workflow](../.github/workflows/still.yml) uses this same action. Pin the action to an immutable commit in production workflows. The external agent process and its dependencies are owned by the consuming workflow.
