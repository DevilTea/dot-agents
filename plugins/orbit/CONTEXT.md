# Orbit Workflow Framework

Orbit is a task-oriented agent framework that decomposes work into structured rounds of Clarify → Planning → Execute → Review.

## Language

### Workflow

**Task**:
A user request tracked as a timestamped directory containing one or more Rounds.
_Avoid_: job, ticket, issue

**Round**:
One complete cycle of Clarify → Planning → Execute → Review within a Task.
_Avoid_: iteration, cycle, sprint

**Phase**:
A named stage within a Round — one of clarify, planning, execute, review, next, or done.
_Avoid_: step, stage

**Status**:
The lifecycle state of a Round — one of in-progress, completed, partial, or blocked.
_Avoid_: state (when referring to lifecycle)

**Mode**:
The execution speed setting for a Round — either simple (quick, auto-confirm) or full (user confirms each phase transition).
_Avoid_: speed, level

### Planning & Execution

**Plan**:
An ordered list of atomic, verifiable steps that Execute will carry out.
_Avoid_: spec, design doc

**Execution Memo**:
The record of what Execute actually did — edits made, validations run, checklist progress.
_Avoid_: changelog, log

**Review Finding**:
A single observation from Review, classified as Critical, Warning, or Info.
_Avoid_: issue, bug, defect (when referring to review output)

**Summary**:
A post-round recap written by Next Advisor — covers outcome, artifacts, and residual risk.
_Avoid_: report, wrap-up

**Template**:
A reusable task scaffold stored in `.orbit/templates/` that pre-fills Clarify branches.
_Avoid_: blueprint, boilerplate

### Infrastructure

**Dispatcher**:
The entry-point agent that creates Tasks, dispatches Rounds, and manages post-round flow.
_Avoid_: router, orchestrator (Dispatcher is the canonical name)

**Agent**:
A role-specialized AI participant in the Orbit workflow (e.g., Planner, Execute, Review, Round).
_Avoid_: bot, model, assistant

**Skill**:
A `.md` file containing domain-specific rules that agents MUST read and follow.
_Avoid_: prompt, instruction set

**Backlog**:
A prioritized pool of future work items stored as Markdown files in `.orbit/backlog/`.
_Avoid_: todo list, queue, inbox

**Memory**:
A persistent knowledge entry stored in `.orbit/memories/` for cross-round recall.
_Avoid_: note, log entry

## Relationships

- A **Task** contains one or more **Rounds**
- A **Round** progresses through exactly four **Phases** (clarify → planning → execute → review), plus optional next and done
- A **Round** has exactly one **Status** and one **Mode**
- A **Plan** is produced during the planning **Phase** and consumed by the execute **Phase**
- An **Execution Memo** is produced during the execute **Phase** and consumed by the review **Phase**
- A **Review Finding** is produced during the review **Phase**
- A **Summary** is produced after the review **Phase** by Next Advisor
- The **Dispatcher** creates **Tasks** and dispatches **Rounds**
- An **Agent** reads one or more **Skills** before acting
- A **Backlog** item may become a **Task** when selected for work
- A **Memory** is archived from a completed **Round**'s **Summary**

## Example dialogue

> **Dev:** "The user filed a new request — should I create a **Task** or add to the existing one?"
> **Domain expert:** "Create a new **Task**. Each user request gets its own timestamped directory. The **Dispatcher** handles creation."
> **Dev:** "And within that **Task**, how many **Rounds** will there be?"
> **Domain expert:** "Usually one, but if **Review** finds critical **Findings**, the **Dispatcher** may launch another **Round** to fix them."
> **Dev:** "Got it. So the **Round** goes through all four **Phases** — clarify, planning, execute, review?"
> **Domain expert:** "Exactly. And the **Mode** determines whether the user confirms each transition or the system auto-advances."

## Flagged ambiguities

- "state" was used to mean both **Status** (lifecycle) and **Phase** (workflow stage) — resolved: Status is the lifecycle state (in-progress/completed/partial/blocked); Phase is the workflow stage (clarify/planning/execute/review/next/done).
- "step" was used to mean both a **Plan** step (an atomic action in an execution plan) and a **Phase** (a stage in a Round) — resolved: use "step" only for Plan steps; use "Phase" for Round stages.
