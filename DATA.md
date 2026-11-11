# Scenario data and sources

The catalog contains five synthetic scenarios. Each uses a $50 USD synthetic order and customer requests. Failed payments and fulfillment decisions are simulations. When a scenario requires a captured payment, the capture and refund responses come from PayPal sandbox.

The basket uses three product types and quantities adapted from the first invoice in [UCI Online Retail](https://archive.ics.uci.edu/dataset/352/online+retail). The source quantities are 6, 6, and 8. We shortened the descriptions and invented USD prices to total $50. The original prices are in pounds sterling. We do not include the original customer ID or invoice number. These baskets are not historical PayPal transactions.

Online Retail is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Cite the dataset as Chen, D. (2015). *Online Retail* [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5BW33.

The original [tau-bench retail policy](https://github.com/sierra-research/tau-bench/blob/main/tau_bench/envs/retail/wiki.md) informed the order-status and cancellation concepts. Its policy requires customer confirmation and authentication. Still uses shorter original scenarios and policies, not benchmark tasks or scores. The original repository is licensed under the [MIT license](https://github.com/sierra-research/tau-bench/blob/main/LICENSE), copyright 2024 Sierra.

A few selected scenarios cannot establish an agent's real-world failure rate. See [scenario sources](docs/scenario-sources.md) for details.
