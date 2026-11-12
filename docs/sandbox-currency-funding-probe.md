# Sandbox currency funding probe

On 2026-11-12 a sandbox-only probe created a test-card-funded GBP 100.00 order and captured it. PayPal returned HTTP 201 and capture `8UD729296M149520T` as `COMPLETED`; order ID was `8NK56090NT717645A`. A subsequent capture lookup returned HTTP 200 and showed GBP 100.00 gross, GBP 2.98 fee, GBP 97.02 net, and USD 125.89 receivable. The currency conversion suggests the merchant's receiving configuration may convert GBP proceeds to USD; it does not establish the cause of any refund rejection.

The balance endpoint returned HTTP 200 with an `as_of_time` of `2026-11-12T05:29:59Z`, GBP 0.00 available and USD 1,684,090.03 available. PayPal documents that balance reports may lag by up to three hours. This older snapshot does not establish current spendable funds or prove that subsequent refunds will succeed. No refund was requested by this probe.

The five fresh GBP 34.00 replacement captures in [multicall reconciliation](evidence/multicall-reconciliation.json) each received PayPal HTTP 422 `REFUND_FAILED_INSUFFICIENT_FUNDS` on the first GBP 17.00 refund. Their full replay remains unverified. The recorded mock first refund completed with a simulated timeout, while the actual first sandbox refund was rejected; a later separate refund call would be a counterfactual, not the same trace, and must not be counted as agreement.

The probe journals its one-use reservation before making the sandbox request. Its local journal contains no credentials. PayPal's [balance documentation](https://developer.paypal.com/api/transaction-search/v1/balances-get/) describes reporting latency, and its [refund API](https://developer.paypal.com/api/payments/v2/captures-refund) documents 422 business-validation responses.
