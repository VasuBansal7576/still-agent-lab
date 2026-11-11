# Pending refund continuation queue

`server/pending-continuation-queue.mjs` scans a saved mock batch for authenticated PayPal sandbox receipts with a confirmed first `PENDING` refund and an explicit second mock refund call. It excludes disputes and uses the existing one-use continuation journal and PayPal sandbox client. It does not create orders or disputes, and it never automatically retries a transport-unknown refund.

```sh
node server/pending-continuation-queue.mjs BATCH-ID 5000
```

The numeric argument limits new attempts. The command processes candidates sequentially. It skips already-claimed continuation journals and stops on unknown provider outcomes, HTTP 401, 403, 429, or 5xx, or any preflight error. Each output line reports the trial and delayed comparison. The final summary counts candidates observed, attempts, agreements, disagreements and unverified results. Pending means pending, not completed. These delayed comparisons are separate from the original immutable receipts and are not included in the aggregate agreement score.

On November 12, 2026 local time, a one-trial sandbox pilot from batch `40f79126-1d0a-4152-b23d-5ef9c221e7ce`, persona `persona-00233e42116b64126550`, trial 4, returned a disagreement. The first sandbox refund `9PN64109LL196402U` and the second `7DV82819332720406` each returned HTTP 201 with `PENDING` status for GBP 86.71, while the mock expected completed refunds. The second call occurred later than the mock trial. The pilot made no real payment.
