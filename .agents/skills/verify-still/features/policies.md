# Edit store policy

Open the lab and choose a scenario. Under `Rules to check`, select the rules to send to the agent and evaluate. Enter optional additional text in `Store policy / agent instructions`. Changing the scenario resets the selection and text.

For a payment-free check, choose `Cancel an unpaid order`, select an agent, and add a distinctive instruction to the field. Run the agent. Expand `Run configuration` in the result and confirm `effectivePolicy` contains the selected rules and instruction. Reopen the result under `Saved runs` and inspect the configuration again. Deselecting every rule must show `Choose a rule` and must not start a run.

Selected rules are checked deterministically. Additional free-text policy is passed to the agent but is not automatically evaluated. Do not claim that a passing verdict proves an added policy was followed. Compare the enabled rules with the checks and recorded evidence.
