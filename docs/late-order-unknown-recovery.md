# Recovery of an uncertain sandbox order

Claim `e50885469d24eb42fe01a9dec1f4e09d1aca78ed2061fae2016d7384d2d6eb05` recorded an unknown Orders API outcome before any refund reservation. The sandbox request implementation used by both the original runner and the current runner was byte-for-byte identical for token acquisition and test-card order creation. The one-use recovery script pinned the full current runner hash, checked the original claim, and repeated its exact request with the original PayPal request ID while the claim was under five hours old. PayPal documents six-hour Orders request-ID retention. The attempt was journaled before sending; an unknown response must never be automatically repeated. If the original order had not reached PayPal, the retry could have created a sandbox order.

PayPal returned HTTP 200 with order `58K46046RL800283S` and capture `7R94991907411711A`; a subsequent capture lookup confirmed `COMPLETED` for GBP 786.84. The guarded continuation re-read that capture and reserved the trial and capture before making its one sandbox refund request. PayPal returned HTTP 201 with refund `9XU50873WS445443N` in `PENDING` status for GBP 786.84. This disagreed with the mock, which expected `COMPLETED`. Pending is not proof that the refund completed. The sandbox-only scripts do not establish complete external refund history or exclusive account access.

The original claim and recovery and continuation journals remain in the local `.data` directory. The authenticated replay receipt is in Still's replay ledger. No credentials or card data are included in this document.

PayPal reference: [Orders v2 create order](https://developer.paypal.com/sdk/orders/v2/orders-create/).
