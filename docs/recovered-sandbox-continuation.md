# Continue a recovered sandbox order

`server/continue-recovered-sandbox.mjs` accepts a server-owned bulk claim whose 500 or 503 order was recovered with the original request ID. It verifies the recovery journal, original trial, currency, amount and current sandbox capture before using Still's durable one-use replay reservation. It never creates an order or dispute. If the trial needs an open dispute, pass an existing dispute ID as the second argument; PayPal must confirm that the unresolved dispute is linked exclusively to the recovered capture. This does not establish complete external refund history or exclusive account access.

```sh
node server/continue-recovered-sandbox.mjs CLAIM-ID [DISPUTE-ID]
```

A one-use continuation journal prevents automatically repeating an uncertain action. A pending refund is not retried as a new decision. On November 12, 2026 local time, claim `81284453a9a0a21f565edbc2c3585f4d40e965004bf38746028686db0632c59f` was recovered after an HTTP 500 using its original request ID. PayPal returned a completed sandbox capture `4T705388B4767570X`. Continuation requested GBP 78.95 and received HTTP 201 with refund `3G174552RB100140P` in `PENDING` state. The original mock trial had another refund call; Still did not make that call after the pending response, so the comparison remains unverified. No real money moved.
