# Scenario data and sources

## Current scenario

The duplicate-cancellation scenario is hand-authored for this project. It uses a synthetic customer request and a $50 USD sandbox payment. It does not contain an imported τ-bench task, an Online Retail basket or a historical PayPal transaction. The actual capture and refund responses must come from the user's PayPal sandbox when the live scenario runs.

The original [τ-bench retail policy](https://github.com/sierra-research/tau-bench/blob/main/tau_bench/envs/retail/wiki.md) describes customer-service rules for order cancellation and refunds. Its policy checks order status and requires explicit customer confirmation. This project uses its own policy and duplicate-request scenario, so its verdicts are not τ-bench scores and the scenario is not a benchmark-compatible task.

The [τ-bench repository](https://github.com/sierra-research/tau-bench) identifies its original retail tasks as outdated and points to the maintained τ³-bench repository for corrected tasks. The original repository is distributed under the [MIT license](https://github.com/sierra-research/tau-bench/blob/main/LICENSE). No original τ-bench task text is included here.

## Online Retail dataset

[Online Retail](https://archive.ics.uci.edu/dataset/352/online+retail) contains historical transactions from a UK retailer. Its creator is Daqing Chen. The dataset is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). UCI requests this citation:

Chen, D. (2015). *Online Retail* [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5BW33.

The current project does not import, transform or distribute this dataset. If it is used later, document the specific source version, transformations and attribution. Basket values would describe historical retail transactions, not PayPal payments or predicted real-world agent failure rates.
