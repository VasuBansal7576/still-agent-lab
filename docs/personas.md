# Synthetic personas and provenance

`generatePersonas({ count, seed })` in `server/personas.mjs` deterministically creates up to 100,000 scenarios. The default is 1,000. The same seed and count produce the same output. Each generated customer and order ID is synthetic. Amounts and currencies are synthetic except for the UCI invoice totals and currency. Approved returns, dispute states, requests, and mutation behaviors are invented. They are not records of PayPal customers or transactions.

Each persona cites one source record and sets `synthetic: true`. Still paraphrases each situation and adds synthetic refund behaviors. Records are rotated across mutations, so each seed receives each mutation over a full cycle. The generator has 30 distinct cited records, not 1,000 independent source records. A 1,000-persona run repeats these records with invented mutations and amounts. The records and adaptations are:

- [τ-bench retail tasks](https://github.com/sierra-research/tau-bench/blob/main/tau_bench/envs/retail/tasks.py), instruction lines 51, 176, 200, 224, 248, 272, 341, 368, 420, 480, 503, 691, 707, 737, 1527, 1577, 1914, 1972, 2077 and 2233. These 20 distinct task records inspire returns, exchanges and payment-method requests. Each generated persona links to its own source line. The source is MIT licensed, Copyright 2024 Sierra. These cases are not τ-bench tasks and results are not comparable to τ-bench scores. No source names, contact details or task instructions are copied into personas.
- [UCI Online Retail](https://archive.ics.uci.edu/dataset/352/online+retail), invoices 536365, 536366, 536367, 536368, 536369, 536371, 536374 and 536376. The invoice and stock codes, quantities, and unit prices are recorded in `server/uci-baskets.mjs`. Invoice totals are calculated from those lines. On November 11, 2026, all 30 lines matched the [official UCI workbook](https://archive.ics.uci.edu/static/public/352/online+retail.zip) for those fields, with workbook prices rounded to pence. These eight early invoices are examples, not a representative sample. Still invents the return approval and customer behavior. Daqing Chen, Online Retail (2015), UCI Machine Learning Repository, [DOI 10.24432/C5BW33](https://doi.org/10.24432/C5BW33), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The invoices are adapted into scenarios and are not PayPal transactions.
- [CFPB complaint 4288475](https://www.consumerfinance.gov/data-research/consumer-complaints/search/detail/4288475), described in the CFPB's [2022 report](https://files-prod.consumerfinance.gov/f/documents/cfpb_buy-now-pay-later-market-trends-consumer-impacts_report_2022-09.pdf), page 26. It inspires a dispute-opening situation. CFPB describes previously published narratives as [public domain for FOIA purposes](https://www.consumerfinance.gov/about-us/newsroom/the-cfpb-to-cease-discretionary-publication-of-complaint-narratives-and-visualizations/). The complaint is an unverified allegation, not a finding or a PayPal record. The narrative is not copied.
- [Public refund dispute discussion 1hb4xjo](https://www.reddit.com/r/personalfinance/comments/1hb4xjo/), about a chargeback and a missing refund transaction identifier. No reuse license was identified. Still retains only a short paraphrase of the situation, not the author's text or identity.

Source: [τ-bench retail tasks](https://github.com/sierra-research/tau-bench/blob/main/tau_bench/envs/retail/tasks.py). Copyright 2024 Sierra. [MIT license](https://github.com/sierra-research/tau-bench/blob/main/LICENSE). The MIT license and copyright notice apply to the source material. The following is its permission notice:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

The generator cycles through nine mutation types. The scenario's amount is a synthetic captured order amount, and `approvedReturn` is the approved partial amount. The request describes the customer behavior. A runner must supply and record the actual payment state, prior requests and tool outcomes. A request alone does not prove a duplicate refund, timeout, impersonation or dispute.

`generateAccountPersonas({ records, count, seed })` is a separate ingestion boundary. Each already sanitized record must have `recordId`, `amount` and `approvedReturn` as two-decimal strings, uppercase three-letter `currency`, and boolean `disputeOpen`. `approvedReturn` must be positive and below the amount. The returned provenance cites the supplied record ID. The output copies only these allowlisted fields, and replaces customer and order identifiers with synthetic ones. The caller is responsible for supplying non-secret record IDs and removing credentials and personal information before ingestion. This function does not connect to PayPal, retrieve data, establish ownership, or validate a real dispute. `url: null` indicates that no public source URL exists for an account record.

The read-only connected-account importer is documented in [account personas](account-personas.md). Its live sandbox behavior remains unverified. A synthetic persona count does not establish real-world failure rates or live sandbox behavior.
