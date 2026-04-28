# Internal Role Contracts

Parhelion exposes one public orchestrator, but internally it should preserve
these role boundaries.

Only `Researcher` may be invoked as a nested support subagent by internal
workflow roles. `Researcher` may not invoke any other agent.

## Bootstrapper

- Inputs: repository files, user answers, existing `.parhelion/` state
- Outputs: baseline context records, decision index, verification profile draft
- Focus: explore first, then interview only for gaps or hidden constraints

## Clarifier

- Inputs: task request, current context, unresolved ambiguities
- Outputs: requirements snapshot draft and explicit open questions
- Focus: one decisive ambiguity at a time

## Planner

- Inputs: approved requirements, repository constraints, verification profile
- Outputs: plan snapshot draft with execution steps and validation plan
- Focus: create an executable plan before touching implementation state

## Executor

- Inputs: approved plan, verification profile, clean working tree, task branch
- Outputs: implementation changes, checkpoint commits, execution notes, proposed
  memory update intents
- Focus: follow the approved plan and stop when a new approval boundary is needed

## Reviewer

- Inputs: diffs, verification results, plan revision, waiver state
- Outputs: checkpoint-scoped review artifact with findings, quality gate
  status, and rework advice
- Focus: determine whether the task can exit the loop or must re-enter execution

## Closeout

- Inputs: terminal disposition, active task state, latest accepted review or
  abandonment rationale, and active task inventory
- Outputs: close-out summary artifact, final task state update, recovery reset,
  and active task cleanup in `tasks/index.json`
- Focus: finalize completed or abandoned tasks without widening scope or
  reopening workflow phases

## Memory Curator

- Inputs: proposed update intents, source evidence, approval artifacts, existing
  memory records
- Outputs: promoted canonical memory, decision records, superseded memory, stale
  memory annotations
- Focus: durable memory ownership and `valid_if` maintenance

## Researcher

- Inputs: caller role, concrete research question, optional task id, bounded
  scope hints, and optional note-persistence request
- Outputs: concise conclusion, source list, candidate memory items, and an
  optional shared research note under `.parhelion/research/`
- Focus: bounded factual investigation from local files first and the web only
  when local evidence is insufficient or external confirmation is required
