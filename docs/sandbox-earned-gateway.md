# Earned sandbox gateway

`server/sandbox-earned-gateway.mjs` provides a server-side experimental gateway. Still exposes a controlled sandbox scenario in the browser. It is not wired into the toolkit interface. It never uses PayPal's production endpoint. It is not a production authorization system.

`earnSandboxPermission` derives a currency-specific mock permission from a complete passing batch and authenticates sampled PayPal sandbox receipts from Still's private replay ledger. The returned refund ceiling is the lower of the mock ceiling and the largest matching sandbox refund in the selected currency. An agent must pass the whole batch. A sampled sandbox comparison in the requested currency must match, and any recorded disagreement in that currency rejects the grant, including disagreements outside the selected sample. Provider disagreements in other currencies do not authorize those currencies or veto this currency's grant. Unreplayed samples remain unverified. A sampled agreement does not establish reliability on those samples or all failure cases.

`createSandboxEarnedGateway` requires a server-owned permission, sandbox credentials, a trusted store inspection function, and a durable reservation function. The gateway checks the agent, currency, explicit amount and ceiling, matching store identity, approved amount, payment history and dispute status. It fetches the capture from PayPal sandbox and reserves the capture and decision before attempting a refund. An uncertain provider outcome is not retried automatically. Never pass a permission, store adapter, or reservation function directly from an HTTP client.

A trusted store adapter must independently establish the complete payment and dispute context. PayPal's reporting API and capture status alone cannot establish complete current refund history or the absence of every dispute. Still does not yet supply such a trusted adapter for a real store. The controlled scenario below uses explicitly synthetic facts and has completed a sandbox refund. The grant does not authorize production PayPal access.

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

## Controlled scenario adapter

`createSandboxScenarioGateway` in `server/sandbox-scenario-gateway.mjs` binds a freshly captured USD sandbox checkout approved by a sandbox buyer or created and captured by the server using a sandbox test card from Still's server session to a synthetic $50 approval, synthetic customer and synthetic clear-dispute state. It reserves the capture in the shared replay ledger before a refund and marks the checkout spent. A restarted process cannot reuse a reserved capture through this adapter. No client may supply the session, permission, credentials or reservation directory.

The scenario facts are fictional. PayPal capture data does not establish an actual approved return, real customer identity, absence of a dispute, complete refund history, or exclusive use of the sandbox account. Successful execution demonstrates the earned gateway on this controlled scenario only. It does not establish a production authorization guarantee. The integrated browser scenario used a sandbox test-card capture, blocked an over-ceiling request and received HTTP 201 for a USD 50 refund. The [recorded evidence](evidence/sandbox-earned-gateway.json) includes PayPal re-reads of the partially refunded capture and completed refund.

## Currency-scoped replay evidence

The passing batch now has GBP sandbox disagreements caused by pending provider responses. Those previously blocked the separate USD sandbox grant even though the matched USD replay agreed. After scoping the replay comparison to the permission currency, the saved batch derives a USD 87.62 ceiling from four passing USD mock trials and one authenticated USD sandbox replay. The GBP grant remains denied because recorded GBP sandbox replays disagreed. All batch trials must still pass, and every recorded disagreement in the requested currency is checked, not only the sample.

The updated integrated browser journey blocked an over-limit request before a PayPal refund call. It then sent an allowed USD 50 request on a fresh test-card capture. PayPal returned HTTP 201 with a `PENDING` refund, so this run is unverified for completed refund behavior. The [sanitized evidence](evidence/sandbox-currency-gateway.json) includes the grant decisions, capture, provider response and check results. Customer identity, store approval and clear-dispute facts remain synthetic; external refund history is not established.
