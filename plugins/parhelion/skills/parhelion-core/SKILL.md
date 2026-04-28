---
name: parhelion-core
description: Use this skill when operating the Parhelion plugin to look up the dispatch policy, hard gate rules, .parhelion state layout, artifact schemas, and interaction taxonomy. Do not use this skill as a substitute for loading the relevant internal agent for your current role.
---

# Parhelion Core

This skill is a **policy and layout reference** for the Parhelion orchestrator.
Role-specific behavior lives in the internal agent files, not here.

## What This Skill Covers

1. Hard gate rules the orchestrator must enforce before dispatch
2. Memory checkpoint triggers
3. Nested delegation boundaries for the `Researcher` support role
4. `.parhelion/` layout and tracking policy (`references/state-root.md`)
5. Artifact format schemas (`references/artifact-schemas.md`)
6. Interaction card taxonomy and action grammar (`references/interaction-taxonomy.md`)
7. Atomic CLI mutation contract (`references/cli-contract.md`)

## What This Skill Does Not Cover

Role-specific procedures, permitted context sets, and output constraints are
defined in the internal agent files:

| Role           | File                               |
| -------------- | ---------------------------------- |
| Bootstrapper   | `agents/internal/Bootstrapper.md`  |
| Clarifier      | `agents/internal/Clarifier.md`     |
| Planner        | `agents/internal/Planner.md`       |
| Executor       | `agents/internal/Executor.md`      |
| Reviewer       | `agents/internal/Reviewer.md`      |
| Closeout       | `agents/internal/Closeout.md`      |
| Memory Curator | `agents/internal/MemoryCurator.md` |
| Researcher     | `agents/internal/Researcher.md`    |

When acting as one of these roles, load the corresponding agent file and only
the references it explicitly permits. Do not load this skill's full reference
set into a role-scoped context.

Internal workflow agents may delegate bounded factual investigation to
`Researcher`. No other nested delegation path is part of the Parhelion policy
model.

## Hard Gate Rules

These rules are enforced by the orchestrator before any dispatch:

1. Requirements must be in `approved` status before advancing to plan phase.
2. Plan must be in `approved` status before entering execute phase.
3. Task branch must not be created until execute phase entry.
4. A dirty working tree must be resolved interactively before branch creation.
5. Destructive git operations require explicit user approval at each occurrence.
6. Verification check skips require a user-approved, unexpired waiver artifact
   on disk.
7. Durable memory writes require curator review at a defined checkpoint.
8. Every user-visible turn ends with `vscode_askQuestions`.
9. Only tasks with `status: active` are dispatchable; terminal close-out is
   handled by the dedicated `Closeout` internal agent.

Routine execute → review iterations may remain internal. Surface the user at
approval gates, material uncertainty, recovery decisions, or final close-out.

## Memory Checkpoints

The orchestrator invokes `MemoryCurator` after:

- Requirements approval
- Plan approval
- Each `accepted` review verdict
- Task close-out (`completed` or `abandoned`)

Accepted review checkpoints may occur inside an internal execute/review loop;
task completion is the final close-out checkpoint after the last accepted
review, while abandonment is a user-confirmed terminal path handled by
`Closeout`.

Research notes may feed these checkpoints as evidence or candidate-memory
inputs, but they never count as curated memory on their own.

## Reference Documents

- `references/state-root.md` — directory layout and tracking policy
- `references/artifact-schemas.md` — all artifact frontmatter and JSON schemas
- `references/interaction-taxonomy.md` — card families and action grammar
- `references/cli-contract.md` — atomic script operations and direct-write boundaries
