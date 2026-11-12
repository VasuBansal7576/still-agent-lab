# Still

The driving test for agents that touch PayPal money.

## Inspiration

A support agent can say the right thing and still send money twice. In a PayPal sandbox experiment, we simulated a timeout after a completed $50 refund. A retry with a new request ID completed a second $50 refund on the same $100 capture. We built Still to expose this kind of decision before an agent receives refund access.

## What it does

Still runs customer scenarios against an agent, records its tool calls, and checks payment decisions against deterministic rules. Synthetic personas cite public source records. Repeated mock trials report pass@1, the share of trials that pass, and pass^N, the share of personas that pass every trial. A failure map groups related mistakes and links to example traces.

A passing run can produce a mock-scoped permission file. Still's gateway enforces its amount ceiling and other conditions. Developers can set checked per-refund and per-order limits, reopen local results, and inspect saved sandbox comparison coverage. A developer can record a connected agent's mock gateway session, promote it to a regression, and rerun the connected agent against a fresh mock. The CLI and GitHub Action support repeatable runs. The hosted replay presents saved sandbox evidence without an account.

## How we built it

The local Node.js app connects scripted agents, local HTTP agents, and configured MCP hosts. Its MCP interface mirrors selected PayPal Agent Toolkit tools. An agent host must accept Still's synthetic scenario and use the supplied connection; an unchanged toolkit agent is not guaranteed to work. Thousands of trials use isolated deterministic mock ledgers. Separate sandbox runs capture actual PayPal responses. AI can explain failures, while deterministic checks decide verdicts. The repository includes a Codex-backed example and a scripted option that requires no model login.

## Challenges

A successful HTTP response is not always a completed refund. Sandbox payments can remain pending, and chargebacks can behave differently from wallet disputes. An earlier completed-refund mock often disagreed with test-card sandbox responses; a later selected profile matched ten selected traces. Neither result establishes general accuracy. We kept uncertain outcomes unverified and separated mock scores from provider evidence. The timeout in the retry experiment was injected.

## Accomplishments that we're proud of

The saved sandbox retry shows two completed refunds for one decision. A separate fixed run reuses the request ID and receives the same refund back. In the browser, both scripted agents ran 1,000 personas five times: the buggy example failed 5,000 mock trials and the corrected example passed 5,000. A mock gateway replay blocked an over-limit request and allowed an eligible one. These examples do not estimate real-world failure rates.

## What's next

Expand toolkit coverage and agent compatibility, verify selected MCP traces against PayPal sandbox, improve mock agreement, and establish complete payment and dispute history before considering production use. Current earned permissions and gateway examples are scoped to the mock.

## Built with

Node.js, JavaScript, PayPal sandbox APIs, PayPal Agent Toolkit, MCP, public retail data, Codex, and GitHub Actions.

## Links

- [Public repository and setup](https://github.com/VasuBansal7576/still-agent-lab)
- [Saved sandbox replay](https://vasubansal7576.github.io/still-agent-lab/)
- [Evidence and limitations](https://github.com/VasuBansal7576/still-agent-lab/blob/main/docs/upgrade-acceptance.md)
- [Earlier demo video file](https://vasubansal7576.github.io/still-agent-lab/still-demo.mp4) (2 minutes 16 seconds). It predates the connected-agent workspace. Devpost's video field requires a supported hosted video link; check the hackathon rules. See [Devpost's video guidance](https://help.devpost.com/article/85-uploading-a-demo-video).

## Judge setup

Clone the repository with Node.js 22 or later, run `npm start`, and open `http://127.0.0.1:3000/upgrade`. Select an included scripted example or connect a local HTTP agent. Scripted mock trials need neither a Codex login nor PayPal credentials. Saved sandbox responses are separate from the fresh mock trials; the public replay works without setup.
