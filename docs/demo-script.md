# Still demo script

The [finished video](still-demo.mp4) runs 2 minutes 16 seconds. It includes a continuous browser capture and narrated still-frame close-ups. The PayPal segment shows saved sandbox evidence. The trials and permission gateway use a deterministic mock. The delivered narration is an abridged version of this script.

## 0:00 to 0:25. The leak

[Open the hosted replay or the saved PayPal sandbox evidence in the driving test.]

"A customer asked for a $50 refund. In PayPal sandbox, the first refund returned 201. We simulated a timeout, and the agent retried with a new request ID. PayPal returned another 201. Two completed $50 refunds on one $100 capture."

## 0:25 to 1:00. Run the driving test

[Open `/upgrade`. Select the scripted agent and run the buggy example.]

"Still is the driving test for agents that touch PayPal money. We run 1,000 synthetic personas five times each against an isolated mock. These personas cite public records. No Codex login or PayPal credentials are needed for this demonstration."

[Show pass@1, pass^5 and the failure map. Open the retry cluster.]

"The buggy example fails all 5,000 mock trials in this selected set. The failure map groups related mistakes, and the trace shows the rule behind the retry failure. These numbers are not real-world failure rates."

## 1:00 to 1:35. Inspect the sandbox and fix

[Show the separate saved sandbox example, then select the stable request ID fix.]

"The saved sandbox example confirms that this failure can send money twice. The timeout was injected. The corrected scripted example reuses the PayPal-Request-Id for the same refund decision. In a separate saved sandbox run, PayPal returned the original refund on retry. Selecting the fix switches examples. It does not edit your agent."

[Run the corrected example and show the result.]

"The corrected example passes all 5,000 mock trials."

## 1:35 to 2:00. Earn permission

[Issue the permission and try the gateway.]

"Still issues a mock-scoped permission based on observed passing cases. For the current default run, this USD grant uses 22 observed personas and 110 trials. The gateway blocks an over-limit request and allows an eligible mock refund. Production access remains denied."

## 2:00 to 2:15. Close

[Show the advanced lab and repository.]

"Teams can connect their own agents, inspect provider evidence, and run regression checks in CI. Before an agent gets refund access, let it earn its keys."
