# Connected HTTP agent rerun checkpoint

On the local app, a scripted v2 HTTP agent passed 50 of 50 mock trials and received a mock permission. Its shadow session `shadow-d6bd8d52-574b-409d-a431-71f45285b6d5` recorded an order lookup, dispute lookup, and refund. After promotion, the browser showed:

- The same scripted agent rerun matched all three mock calls.
- A modified agent that skipped the dispute check changed two call positions.
- An unavailable endpoint produced an unverified result.

These are mock results. The endpoint address does not authenticate the agent, and this checkpoint does not establish PayPal behavior.
