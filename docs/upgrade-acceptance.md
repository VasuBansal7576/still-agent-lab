# Driving test upgrade: acceptance evidence

Recorded 2026-11-11. The upgrade is incomplete. Sandbox evidence below is distinct from the deterministic mock; neither synthetic personas nor these trials establish real-world failure rates.

| Acceptance | Status | Evidence and limits |
| --- | --- | --- |
| $100 retry leak and stable request ID against PayPal | Unverified | Both flows are implemented and were exercised against a labeled synthetic provider fixture. Two new $100 sandbox captures and buyer approval are needed to observe real responses and resulting state. |
| Open dispute rule with a real sandbox dispute | Unverified | No sandbox dispute was created; buyer-side dispute creation is a human-only blocker. |
| 1,000 public-data persona variants and repeated trials | Passed in mock | The driving-test browser ran 1,000 personas × 5 trials for each scripted agent. Provenance names source records; variants are synthetic, derived from a small seed set. |
| Reliability and failure map | Passed in mock | CLI and browser show pass@1, pass^5, and failure clusters. `still test --personas 1000 --trials 5` gave 5,000 passes; `--agent buggy` gave 5,000 failures across duplicate, dispute, identity, missing amount, and approved-return clusters. Scripted trials are deterministic. |
| Real sandbox replays and agreement | Unverified | A replay plan exists, but no qualifying replay or agreement score is available. Fresh approved captures and complete refund history are required. |
| Earned permission enforced on replay | Partial | A mock-only earned grant and fail-closed gateway were exercised in process. The browser's mixed-currency batch correctly received a denial; no real sandbox permission has been earned. |
| Toolkit/MCP agent connects | Partial | MCP stdio tools and an example client are present; external agent v2 was exercised against the mock over loopback. End-to-end use with an actual PayPal Agent Toolkit agent is unverified. |
| Shadow session promoted and rerun | Passed for mock example | Browser recorded, promoted and reran mock regression `b4a4d517-590b-4710-a269-2915a71a9d3f`, including a blocked refund. Recording a real agent's live session is unverified. |
| CLI and GitHub Action | Passed in mock | Local 1,000 × 5 CLI run passed. [GitHub Actions run 43058554096](https://github.com/VasuBansal7576/still-agent-lab/actions/runs/43058554096) completed successfully for commit `9156124`. |
| Public repo, license, setup and judge replay | Partial | LICENSE and setup exist. [Hosted read-only replay](https://still-sandbox-replay-vasu.zippy17.chatgpt.site) displays earlier $50 real sandbox traces; it does not prove the new $100 case. [Public repository](https://github.com/VasuBansal7576/still-agent-lab) was synchronized at commit `9156124`. |
| Connected-account personas | Unverified | Read-only import is implemented but has not been exercised with the connected account on this revision. |

Earlier $50 sandbox traces show an already-refunded capture being rejected with HTTP 422 and the corrected scripted flow avoiding the duplicate. They are not evidence for two successful partial refunds.
