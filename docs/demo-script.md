# Still demo script

Target duration: 2 minutes 30 seconds. Show only sandbox and mock data. The sandbox footage is a saved replay, not a fresh transaction.

## 0:00 to 0:25. The leak

[Open the hosted replay. Show the buggy retry and expand its provider trace.]

"A customer asked for a $50 refund. In PayPal sandbox, the first refund returned 201. We simulated a timeout, and the agent retried with a new request ID. PayPal returned a second 201. Two completed $50 refunds on one $100 capture."

## 0:25 to 0:50. The driving test

[Open the driving test. Show the agent selector and start the buggy example with 1,000 personas and five trials.]

"Still is the driving test for agents that touch PayPal money. Connect an agent or use the scripted example. These synthetic personas cite public sources. The repeated trials run against a deterministic mock, not PayPal."

## 0:50 to 1:20. Find the failure

[Show pass@1, pass^5, the failure map, and the duplicate refund example. Return to the hosted replay and show both provider responses.]

"The buggy example fails all 5,000 mock trials in this selected set. The failure map groups related mistakes and lets us inspect a trace. The saved sandbox replay confirms the retry leak for this example. The timeout was injected, and these results are not real-world failure rates."

## 1:20 to 1:50. Fix and earn access

[Show the stable request ID sandbox trace. Select Corrected example and run the same 1,000 by five mock trials. Export the permission and replay it.]

"The fix uses the same PayPal-Request-Id for the same refund decision. In the saved sandbox run, PayPal returned the original refund on retry. The corrected scripted agent passes the mock run. Still issues a mock-scoped permission based on observed passing cases. The gateway blocks a refund above its ceiling and allows an eligible one."

## 1:50 to 2:15. Make the result useful

[Show the permission download, shadow record and promote controls, and the CLI documentation.]

"Teams can export the permission, record a mock gateway session and promote it to a regression, or run the CLI in CI. Sandbox permissions need separate evidence. Still does not grant production access."

## 2:15 to 2:25. Close

[Show the repository and hosted replay.]

"Before an agent gets refund access, let it earn its keys. Still makes the decisions, provider evidence, and limits visible."
