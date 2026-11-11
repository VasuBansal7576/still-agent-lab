# Sandbox pending capture recovery

`server/resume-pending-capture.mjs` checks a single saved bulk claim that stopped before the replay ledger reservation because PayPal did not report the expected completed capture. It uses PayPal sandbox only. It never creates a new order or dispute.

```sh
node server/resume-pending-capture.mjs CLAIM-ID
node server/resume-pending-capture.mjs CLAIM-ID --execute
```

The first command is read-only against PayPal. It requires a server-owned claim with the exact pre-reservation failure, a matching original trial and captured amount, and no existing replay-key reservation, capture reservation or receipt. It then re-reads the capture and the specific linked dispute. `ready` requires PayPal to return a `COMPLETED` capture and an unresolved dispute exclusively linked to that capture.

The second command repeats those checks and proceeds only when they pass. It first writes a private one-use journal, checks that the claim did not change, and uses the existing replay ledger's durable key and capture reservations before any refund. The executor rechecks the dispute immediately before the refund. An unknown outcome is not retried automatically. The private journal is under `.data/pending-capture-recovery/`; the sandbox replay receipt is under `.data/replay-ledger/`. PayPal capture data does not establish complete external refund history or exclusive account access.

On November 11, 2026 UTC, PayPal returned HTTP 200 with `PENDING` for captures `07K938113B364652Y`, `00L51783WX566741G`, `4EJ72960728865022` and `9M065972JR897290S`. Their linked disputes were `WAITING_FOR_SELLER_RESPONSE`. The tool reported each case unverified and attempted no refund. A successful resumed refund with this tool remains unverified until PayPal reports an eligible completed capture and the replay is performed.
