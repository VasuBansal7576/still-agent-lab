# Earned sandbox gateway

`server/sandbox-earned-gateway.mjs` provides a server-side experimental gateway. It is not yet wired into the Still browser or toolkit interface. It never uses PayPal's production endpoint. It is not a production authorization system.

`earnSandboxPermission` derives a mock permission from a complete passing batch and authenticates sampled PayPal sandbox receipts from Still's private replay ledger. The returned refund ceiling is the lower of the mock ceiling and the largest matching sandbox refund in the selected currency. An agent must pass the whole batch. A sandbox comparison must match, and any recorded disagreement rejects the grant. Unreplayed samples remain unverified. A sampled agreement does not establish reliability on those samples or all failure cases.

`createSandboxEarnedGateway` requires a server-owned permission, sandbox credentials, a trusted store inspection function, and a durable reservation function. The gateway checks the agent, currency, explicit amount and ceiling, matching store identity, approved amount, payment history and dispute status. It fetches the capture from PayPal sandbox and reserves the capture and decision before attempting a refund. An uncertain provider outcome is not retried automatically. Never pass a permission, store adapter, or reservation function directly from an HTTP client.

A trusted store adapter must independently establish the complete payment and dispute context. PayPal's reporting API and capture status alone cannot establish complete current refund history or the absence of every dispute. Still does not yet supply such a trusted adapter for this gateway. A positive sandbox refund through this module is **unverified**. Its grant does not authorize production PayPal access.

## Observed evidence

On November 11, 2026, the module derived a USD 87.62 sandbox-only ceiling from local passing batch `d0c88817-eae0-471a-93d1-571fdd77f8ca`. Its evidence comprised four USD mock trials and one authenticated sampled USD sandbox replay. With credentials loaded from macOS Keychain, a USD 99.00 refund request was blocked before any provider refund call. This proves only the over-ceiling denial. It does not prove the positive refund path or full sandbox reliability.

From the project directory, the following command recomputes the grant when that local batch and replay ledger still exist. It does not require credentials or make a PayPal request. Another checkout needs its own saved batch and authenticated replay ledger.

```sh
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
import { createReplayLedger } from './server/replay-ledger.mjs';
import { earnSandboxPermission } from './server/sandbox-earned-gateway.mjs';
const batchId = 'd0c88817-eae0-471a-93d1-571fdd77f8ca';
const batch = JSON.parse(await readFile(`.data/batches/${batchId}.json`));
const ledger = await createReplayLedger({ directory: '.data/replay-ledger' });
console.log(JSON.stringify(await earnSandboxPermission({ batchId, batch, ledger })));
NODE
```
