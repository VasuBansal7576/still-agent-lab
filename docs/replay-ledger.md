# Sandbox replay ledger

`createReplayLedger({ directory })` creates a private, server-owned ledger. The parent of `directory` must already exist. Its `execute(options)` method calls `executeSandboxReplay` with its own reservation function. The server supplies the adapter, approval, refund history, session, and planned item. Do not accept these trusted objects or provider receipts from a browser.

The ledger reserves the replay key and capture ID across sessions before any refund call. Reservation directories are created exclusively and synced. A failed or interrupted reservation may consume a key or capture without a refund. A crash or uncertain refund outcome never releases a reservation. Do not delete or replace the ledger to retry a capture. Investigate the provider state and use a different human-approved fresh capture for a new replay.

`evidence()` returns saved executor results. Pass those results and `verifyReceipt` to `reconcileSandboxReplays`. `verifyReceipt` compares each receipt with the server-owned file and the replay key. It does not authenticate arbitrary client-supplied evidence. Keep the ledger directory private and persistent, and restrict all writes to the server process. Evidence files contain filtered provider responses, not credentials or access tokens.

A crash while saving a receipt can leave an incomplete file. Such a file is ignored by `evidence()` and cannot verify. The reservation remains in place, so the outcome remains unverified and the capture cannot be reused. The ledger requires a local filesystem that provides exclusive directory creation and durable directory syncing. It is for sandbox use only.
