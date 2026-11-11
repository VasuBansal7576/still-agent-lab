# Recorded sandbox case agreement

Run `node server/observed-agreement.mjs` to compare the recorded refund actions with the deterministic mock. The command reads `docs/evidence/sandbox-retry.json` and `docs/evidence/sandbox-dispute.json`. It makes no sandbox calls and needs no credentials.

The result counts each recorded run as one case. A case agrees only when all its compared fields agree. Missing evidence is unverified and excluded from the agreement denominator. The result includes each field and both values for inspection.

For refund calls, the comparison checks HTTP status, success, completed outcome, amount, currency, whether refund identities repeat across calls, and final capture status. The dispute case also checks that the dispute is open before and after the refund. The mock represents the recorded `UNDER_REVIEW` state as `OPEN`. Mock and sandbox refund IDs differ, so the comparison checks identity relationships rather than literal IDs.

The recorded timeout is simulated after the sandbox response. The comparison executes the recorded requests against the mock without its timeout injection, so it compares provider responses rather than an agent's view of a timeout. It does not compare agent verdicts or establish that a dispute claim paid out.

These cases are not a random batch sample or a replay of every failure. Their agreement is not a batch-wide accuracy estimate and does not satisfy the sampled sandbox replay acceptance criterion.

Server integration can call `loadObservedAgreement()` from `server/observed-agreement.mjs`. It returns the comparison object. `compareObservedEvidence({ retry, dispute })` accepts already loaded records. Only use trusted evidence with that function. Its source label alone does not authenticate supplied records.
