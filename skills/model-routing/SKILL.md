---
name: model-routing
description: Claude Code model and reasoning-effort routing table. Use when delegating work to subagents or workflow agents, planning multi-agent runs, choosing a model or effort for a task, or changing Claude Code model defaults. Matches task nature to the cheapest adequate model/effort tier to avoid waste.
---

# Model Routing

Assign each unit of work the cheapest model/effort that is adequate for its task class. The canonical assignments live in [references/routing.yaml](references/routing.yaml) — read it when applying this skill; do not route from memory.

## When NOT to use

- The user or project instructions already name a model or effort — that always wins.
- Single-session work with no delegation and no model choice to make.

## Procedure

1. **Classify** each task unit into exactly one task class defined in `routing.yaml` (`task_classes` section). If a unit spans classes, split it into smaller units; if it cannot be split, use the most demanding class involved.
2. **Look up** the assignment under `assignments`.
3. **Apply** through `model` / `effort` options on subagent or workflow-agent calls; use `/model` for the main session. Omitting `model` inherits the main-loop model, so a fan-out launched from a high tier runs entirely at that tier — set it explicitly whenever the caller sits above the task class.
4. **Escalate on failure, don't loop.** If the assigned tier fails repeatedly on the same unit, escalate one step — effort first, then model — with the new evidence in the brief. If failure traces to an unclear spec, fix the spec instead: no effort level compensates for an unstated acceptance criterion.
5. **Respect reserved tiers.** A tier the `policy` section marks reserved is outside the escalation path. Judging a task hard does not authorize it — run the unit at its assigned tier, then hand the user the failure evidence and let them decide.

## Output

For each delegated or configured unit, state the chosen (model, effort) and the task class that justified it, so the routing is reviewable. When a unit runs on a reserved tier, also name the user request that authorized it.

## Maintaining the table

Model lineups and effort ranges change. Before editing `routing.yaml`, verify model IDs and supported effort levels against Claude Code's current model list (`/model`). Keep model names in the YAML only — `SKILL.md` stays lineup-agnostic.
