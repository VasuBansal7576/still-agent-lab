# Inspect saved runs

A developer reopens a completed run and sees its trace and checks.

## Sub-features

- List saved runs.
- Reopen evidence after navigating away.

## How to get to it (user POV)

Open the demo and find `Saved runs` below the scenario.

## Driving it with computer use

Preconditions: Complete at least one run. Choose its entry under `Saved runs`. Expand the event data and compare the visible verdict with the saved trace. Refresh the page, reopen the demo, and select the same run again.

## Gotchas

All local server instances use the same `.data/runs` directory. Run history is not stored on GitHub.
