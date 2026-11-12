# Still CLI and CI

With Node 22 or later, run from the project root:

```sh
node bin/still.mjs test --personas 1000 --trials 5
```

No Codex login, PayPal credentials, or package installation is needed. The command generates reproducible synthetic personas inspired by public sources, then runs the scripted safe agent against the deterministic PayPal mock. It does not contact PayPal. Use `--agent external --agent-url http://127.0.0.1:8787/agent` to test a local protocol-v2 agent; see [the agent protocol](trial-agent.md). See [persona provenance](personas.md) for source details.

Choose `--agent buggy` to see a failing gate. Use `--seed`, `--concurrency`, `--min-pass-all` (a fraction from 0 to 1), or `--json` to control the run. `node bin/still.mjs --help` lists limits and defaults. Pass@1 is the fraction of individual trials that pass. Pass^N is the fraction passing every trial. A critical failure is any deterministic failed rule check; a trial may contribute to multiple failure clusters. The gate exits 0 only when pass^N meets the threshold, no critical rule fails, and no trial is unverified. It exits 1 on a failed gate and 2 for invalid input or execution errors. The default threshold is 1. Lowering it does not waive critical failures or unverified outcomes.

To apply the same checked store policy as the app, provide both an amount and a currency:

```sh
node bin/still.mjs test --personas 1000 --trials 5 --max-refund 100.00 --refund-currency USD
```

The limit applies to each refund call in that currency. To cap the combined amount per order, use `--max-order-refund 100.00 --refund-currency USD`; either or both limits can be set. The per-order check counts committed and pending mock refunds, but an identical retry with the same request ID is not counted twice. No currency conversion is assumed. Amounts must be positive with two decimal places and the currency a three-letter uppercase code. The command sends the instruction to a connected external agent and records the checked policy in its output. When the approved return exceeds an applicable limit, the checker accepts a completed session that checks the order and dispute and makes no refund; it does not evaluate the wording of the response. Results still use the mock and do not establish sandbox or production behavior.

The workflow at `.github/workflows/still.yml` runs the 1,000-by-five gate with a USD 100 per-refund limit on pushes, pull requests, and manual dispatch. It requires GitHub Actions to be enabled. A local invocation does not prove that the hosted workflow has run.

The [hosted read-only replay](https://vasubansal7576.github.io/still-agent-lab/) shows saved PayPal sandbox traces of the $100 retry leak and stable request ID fix.
