# Run payment scenarios

A developer tests refund decisions using a real PayPal sandbox capture and sees the provider responses.

## Sub-features

- Duplicate refund attempt and corrected response.
- Refund amount above the captured balance.

## How to get to it (user POV)

Open the demo and select `Repeated cancellation request` or `Refund above the amount paid`.

## Driving it with computer use

Preconditions: Configure sandbox credentials and a compatible sandbox buyer and seller. Use no real payment account.

Select an agent. Choose `Create sandbox order`, open PayPal sandbox, approve the $50 payment as the sandbox buyer, return to the lab, and choose `Capture approved order`. Choose `Run the agent`. Expand the timeline entries to inspect the capture, refund request, PayPal response, and checks. Repeat with a fresh capture for each agent.

## Gotchas

A provider rejection of an unsafe request is not a successful second refund. Model outcomes can vary. A failed or missing response is unverified.
