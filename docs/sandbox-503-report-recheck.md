# PayPal sandbox 503 report recheck

On November 12, 2026 at approximately 03:40 UTC, Still used the connected sandbox account to read PayPal transaction reports around five refund calls that had returned HTTP 503. No refund was sent. A broad report returned `RESULTSET_TOO_LARGE`, so the check read every page in a six-minute window centered on each locally recorded request time. The five windows required 8, 8, 11, 19 and 14 pages respectively.

Four capture IDs had linked `T0200` currency-conversion rows. Those rows did not establish a refund. The fifth capture had no linked report row in its window. These are narrow observations, not proof that PayPal rejected the five requests. A refund might be reported outside the selected window or be omitted or delayed; Still does not have a documented lookup by request ID. The five outcomes remain unverified, and none was automatically retried.

The capture IDs checked were `2TJ9483304451523J`, `77V75765L2479350P`, `7P490480N5737100C`, `3W346493CH184302A`, and `32F56517PR2695601`. The last was a delayed continuation; the others were immediate replay attempts. PayPal's [transaction details definition](https://developer.paypal.com/api/transaction-search/v1/definitions/transaction_detail/) identifies the reference ID as a related pre-existing transaction and the event code as the event classification.
