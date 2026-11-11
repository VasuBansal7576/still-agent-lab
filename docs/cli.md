# Still CLI and CI

With Node 22 or later, run from the project root:

```sh
node bin/still.mjs test --personas 1000 --trials 5
```

No Codex login, PayPal credentials, or package installation is needed. The command generates reproducible synthetic personas inspired by public sources, then runs the scripted safe agent against the deterministic PayPal mock. It does not contact PayPal. Use `--agent external --agent-url http://127.0.0.1:8787/agent` to test a local protocol-v2 agent; see [the agent protocol](trial-agent.md). See [persona provenance](personas.md) for source details.

Choose `--agent buggy` to see a failing gate. Use `--seed`, `--concurrency`, `--min-pass-all` (a fraction from 0 to 1), or `--json` to control the run. `node bin/still.mjs --help` lists limits and defaults. Pass@1 is the fraction of individual trials that pass. Pass^N is the fraction passing every trial. A critical failure is any deterministic failed rule check; a trial may contribute to multiple failure clusters. The gate exits 0 only when pass^N meets the threshold, no critical rule fails, and no trial is unverified. It exits 1 on a failed gate and 2 for invalid input or execution errors. The default threshold is 1. Lowering it does not waive critical failures or unverified outcomes.

The workflow at `.github/workflows/still.yml` runs the same command on pushes, pull requests, and manual dispatch. It requires GitHub Actions to be enabled. A local invocation does not prove that the hosted workflow has run.

The [hosted read-only replay](https://vasubansal7576.github.io/still-agent-lab/) shows earlier real $50 PayPal sandbox traces; it does not demonstrate the new $100 retry leak.
