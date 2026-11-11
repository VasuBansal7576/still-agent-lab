# PayPal agent-testing factory

## Skill routing

Pstack skills live at:

`/Users/vasu/.codex/plugins/cache/personal/pstack-codex/0.15.36-codex.8/skills/`

When this file says `/skill-name`, read and follow `<pstack skills directory>/skill-name/SKILL.md`. These labels are file pointers, not a claim that every skill is exposed as a slash command.

The user's instructions override skill defaults. In this project, unit tests, irrelevant tests, code review, PR review and review bots are banned. Do not invoke or perform those activities even if a skill requests them.

## Goal

Build a tool that tests online-store support agents using PayPal sandbox. Read [PRODUCT.md](PRODUCT.md) before planning or implementing product behavior. It defines the intended experience, demo and acceptance criteria.

When the user authorizes the whole product, continue through the full intended experience in PRODUCT.md, not just the first demo. The first demo is an early proof point, not a stopping condition. Keep an acceptance record for agent connection, policies, scenarios and data provenance, sandbox actions, deterministic checks, explanations, result inspection, reruns, and the requested delivery destination. Mark each item passed only with evidence from the integrated product. Continue implementation and verification until all authorized requirements pass or a concrete permission or external blocker prevents further progress. A progress or status question does not stop the work. Preserve the user's bans on unit tests, irrelevant tests, code review, and PR review.

## Factory workflow

1. **Route.** Use `/poteto-mode` for the requested work. For a multi-phase build, use `/figure-it-out` to define acceptance criteria, sequence and evidence. Keep the original product goal visible throughout.
2. **Isolate.** Inspect the workspace before editing. Give parallel writers separate worktrees or exclusive file ownership. Isolate ports, data and sandbox transactions where necessary. Establish the project scaffold before splitting dependent work.
3. **Build.** Use `/poteto-mode` and its Feature playbook for implementation. Establish a runnable scaffold and prove the PayPal sandbox payment and refund path before expanding the UI or scenario catalog.
4. **Prove.** Use `/principle-prove-it-works` to verify the integrated app against the user's acceptance criteria. Drive the real user journey and capture relevant responses and resulting state.
5. **Make proof repeatable.** Once the first real user journey works, use `/create-verification-skill` to document and run the app-specific verification path. Do not generate a skill against an unbuilt app.
6. **Fix and repeat.** If a journey fails, use `/poteto-mode` and its Bug fix playbook to reproduce, diagnose and fix it. Repeat the relevant user journey until it passes or a real blocker prevents verification.
7. **Record.** Use `/show-me-your-work` for the build's decision trail. Record decisions, evidence, failures and unresolved blockers. Skip its review step because code and PR review are banned.
8. **Ship.** Prepare the runnable app, setup instructions and requested demo materials. Verify the final environment through the same user journey. Publish, deploy, merge or submit within the authority granted. Report passed, failed and unverified outcomes.
9. **Communicate.** Use `/unslop` for the README, demo copy and final report.

## Proof required for the first demo

- Each agent starts with a fresh equivalent captured sandbox payment.
- The first refund succeeds and the actual PayPal response is visible.
- The buggy agent makes a second refund attempt and the checker flags it.
- The corrected agent receives the duplicate request and makes no second refund call.
- The timeline shows enough evidence to inspect each verdict.
- Missing or ambiguous evidence is unverified, not a pass.
- Keep credentials and access tokens out of saved evidence.

## Verification limits

- Unit tests and irrelevant tests are banned.
- Code review, PR review, Greptile and other review loops are banned.
- Run only checks that directly establish requested behavior or that the app starts and works in its intended environment.
- Mocked or prerecorded responses do not prove live PayPal behavior.
