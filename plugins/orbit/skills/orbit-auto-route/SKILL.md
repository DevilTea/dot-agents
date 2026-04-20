---
name: orbit-auto-route
description: "Routing decision tree for Orbit Dispatcher startup state analysis. Determines whether to recover an interrupted round, dispatch Next Advisor, offer the backlog, or prompt for new work."
---

# Auto-Route

This skill defines the routing decision tree that the Orbit Dispatcher evaluates on every new user turn. It determines the correct action based on the state of the most recent round. This skill is **read-only** — all actions are performed by the Dispatcher itself.

## Detecting the Latest Round

1. List directories in `.orbit/tasks/` and sort lexicographically. The **last** entry is the latest task.
2. Within that task directory, list `round-NNNN` subdirectories. The **highest** numbered round is the latest round.
3. Run `round-state` on that round to read its `state.json`.

If `.orbit/tasks/` is empty or does not exist, skip directly to Branch 4.

## Decision Branches

Evaluate in strict order. The **first** matching branch wins.

### Branch 1 — Interrupted Round Recovery

**Condition:** The latest round has `status` that is NOT `"completed"` (i.e., `"in-progress"`, `"partial"`, `"blocked"`).

Apply phase-aware recovery:

| Phase                   | Recovery Action                                                                                                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clarify` or `planning` | No workspace changes were made. Create a new round in the same task. The interrupted round is left as-is for forensics.                                                                                                                                                    |
| `execute`               | Workspace may have partial edits. Update the interrupted round's status to `"abandoned"` via `round-state --patch '{"status":"abandoned"}'`. Create a new round in the same task. Alert the user that partial edits from the interrupted round may need manual inspection. |
| `review`                | Execute completed successfully. Re-enter the interrupted round and dispatch only the Review phase (do not re-run Execute).                                                                                                                                                 |
| `next`                  | Next Advisor was interrupted. Re-enter the round and re-dispatch Next Advisor.                                                                                                                                                                                             |

### Branch 2 — Completed Round → Next Advisor

**Condition:** The latest round has `status == "completed"` AND `phase == "done"`.

Check if `summary.md` in that round directory is empty or contains only the scaffold heading `# Summary`. If so, dispatch `Orbit Next Advisor` for that round.

If `summary.md` already has substantive content, this branch does not match — fall through.

### Branch 3 — Backlog Available

**Condition:** No recovery or Next Advisor action was triggered by the branches above.

Check `.orbit/backlog/` via `backlog-list` CLI command. If items exist, dispatch `Orbit Backlog` agent to let the user pick from available work.

### Branch 4 — Nothing to Do

**Condition:** None of the above branches matched.

Inform the user that no pending work was found and ask them to describe what they want to do.

## CLI Commands Used

| Command                                                                | Purpose                        |
| ---------------------------------------------------------------------- | ------------------------------ |
| `node .orbit/scripts/cli.mjs round-state <roundPath>`                  | Read the state.json of a round |
| `node .orbit/scripts/cli.mjs round-state <roundPath> --patch '<json>'` | Update a round's state         |
| `node .orbit/scripts/cli.mjs backlog-list`                             | List backlog items             |

## Important Notes

- This skill is consumed exclusively by the Orbit Dispatcher (`Orbit.agent.md`).
- The Dispatcher reads this skill and evaluates the decision tree — the skill itself performs no actions.
- If the user's message clearly indicates a new task (regardless of prior state), the Dispatcher may skip auto-route and proceed directly to classification and round creation.
