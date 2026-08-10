---
name: model-routing
description: Cross-harness model and reasoning-effort routing table. Use when delegating work to subagents, planning multi-agent runs, choosing a model or reasoning effort for a task, or configuring model defaults in Claude Code, Codex CLI, or Antigravity. Matches task nature to the cheapest adequate model/effort tier to avoid waste.
---

# Model Routing

Assign each unit of work the cheapest model/effort that is adequate for its task class. The canonical assignments live in [references/routing.yaml](references/routing.yaml) — read it when applying this skill; do not route from memory.

## When NOT to use

- The user or project instructions already name a model or effort — that always wins.
- Single-session work with no delegation and no model choice to make.

## Procedure

1. **Classify** each task unit into exactly one task class defined in `routing.yaml` (`task_classes` section). If a unit spans classes, split it into smaller units; if it cannot be split, use the most demanding class involved.
2. **Look up** the assignment for the current harness under `harnesses.<harness>.assignments`. For a harness not in the table, apply the `principles` section and pick the nearest capability tier by analogy.
3. **Apply** through the harness's own mechanism:
   - Claude Code: `model` / `effort` options on subagent or workflow-agent calls; `/model` for the main session.
   - Codex CLI: `model` and `model_reasoning_effort` in `~/.codex/config.toml`, per-profile via `[profiles.<name>]` (`codex --profile <name>`), or subagent defaults under `[agents]`.
   - Antigravity: model picker per conversation/agent.
4. **Escalate on failure, don't loop.** If the assigned tier fails repeatedly on the same unit, escalate one step — effort first, then model — with the new evidence in the brief. If failure traces to an unclear spec, fix the spec instead: no effort level compensates for an unstated acceptance criterion.

## Output

For each delegated or configured unit, state the chosen (model, effort) and the task class that justified it, so the routing is reviewable.

## Maintaining the table

Model lineups and effort ranges change. Before editing `routing.yaml`, verify slugs and supported effort levels against the harness's current model list (e.g. Codex `~/.codex/models_cache.json`, Claude Code `/model`, Antigravity picker). Keep model names and prices in the YAML only — `SKILL.md` stays lineup-agnostic.
