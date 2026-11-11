# Run payment scenarios

A developer tests refund decisions using a real PayPal sandbox capture and sees the provider responses.

## Sub-features

- Duplicate refund attempt and corrected response.
- Refund amount above the captured balance.

## How to get to it (user POV)

Open the demo and select `Repeated cancellation request` or `Refund above the amount paid`.

## Driving it with computer use

Preconditions: Configure sandbox credentials and a compatible sandbox buyer and seller. Use no real payment account.

Choose `Repeated cancellation request` and the buggy agent. Choose `Create sandbox order`, open PayPal sandbox, approve the $50 payment as the sandbox buyer, return to the same lab tab, and choose `Capture approved order`. Choose `Run the agent`. Expand `View event data` to inspect both customer requests, the first completed refund and actual PayPal response, the second refund attempt, its provider response, and the duplicate rule's failure evidence. Reopen the saved run.

Repeat with the corrected agent and a fresh equivalent capture. Confirm the first refund completed, the second customer request appears, and the trace supports no second refund call. Inspect every check and reopen the saved run. Missing or ambiguous evidence is unverified. Agent behavior can vary; a label alone does not prove either outcome.

For `Refund above the amount paid`, use another fresh capture and inspect the requested amount, remaining balance, provider response, and deterministic rule verdict. For `Return part of an order`, verify the requested and completed refund amount and response. These are separate runs, not evidence for the duplicate-cancellation demo.

## Gotchas

A provider rejection of an unsafe request is not a successful second refund. Model outcomes can vary. A failed or missing response is unverified.
