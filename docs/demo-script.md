# Still demo script

The [finished video](still-launch.mp4) runs 84.8 seconds. The opening uses saved PayPal sandbox evidence. The app run uses Still's scripted agent and deterministic mock. No real money moved. Narration uses the open-source Kokoro v1.0 `af_heart` voice.

## 0:00 to 0:17. The problem

Show the saved sandbox refund responses. Label them "Saved PayPal sandbox evidence" and "Timeout simulated."

> A customer asked for a 50 dollar refund. The first refund succeeded, but the agent saw a simulated timeout and retried as a new request. PayPal sandbox returned success again. Two 50 dollar refunds came out of one 100 dollar capture.

## 0:17 to 0:31. The solution

Show the Still title and the driving-test page.

> Meet Still, the driving test for agents that touch PayPal money. Before an agent gets refund access, Still runs customer scenarios, checks its decisions, and shows the evidence behind each result.

## 0:31 to 0:47. Run the agent

Connect the scripted sample and run 1,000 personas with five trials each. Show the results, failure map, and retry trace. Label the run "Scripted agent. Deterministic mock."

> Here we connect Still's buggy sample. We run 1,000 synthetic personas, each five times, against a mock. All 5,000 selected trials fail. The failure map brings us to the retry trace, where the agent makes two refund decisions.

## 0:47 to 1:06. Fix and rerun

Show the saved sandbox evidence, switch to the corrected sample, and rerun. Label the sandbox evidence separately from the mock run.

> The saved sandbox responses show why this matters. The corrected sample reuses a stable PayPal request ID for the same refund decision. In a separate sandbox run, the retry returned the original refund. Back in the mock, the corrected sample passes all 5,000 trials.

## 1:06 to 1:21. Earn permission

Request the mock permission and show the gateway blocking an over-limit refund and allowing an eligible one. Keep "Mock only" visible.

> Still issues a mock permission based on the passing run. Its gateway blocks a refund above the earned limit and allows an eligible one. Teams can inspect the traces, connect an agent, and run regression checks in CI.

## 1:21 to 1:25. Close

Show the Still title and repository address.

> Still. Let your agent earn its PayPal keys.

The figures describe these scripted mock trials, not real-world failure rates. The timeout was injected, and the sandbox replay is saved evidence rather than a new live PayPal run.
