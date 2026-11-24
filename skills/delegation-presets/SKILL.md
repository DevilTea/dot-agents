---
name: delegation-presets
description: Ready-made presets for Claude Code subagents and workflows — model, effort, agent type, brief contents and expected report for each recurring kind of delegated work (search, implementation, review, finding verification, debugging, research, docs). Use when spawning a subagent, authoring a workflow script, or running an independent review in a separate session.
---

# Delegation Presets

Pick the preset that matches the delegated unit and apply all of its fields. Explicit user or project instructions about model, effort or agent type always win.

## Model policy

- **Opus is the working tier.** Vary effort to match the task instead of switching to a faster model; a cheaper model that needs extra correction rounds costs more than it saves.
- **Haiku only for low-judgment search and reporting**: locating files, symbols, strings and configuration, and quoting what is there. If the unit has to decide whether something is a bug, which design is better, or what to change, it is not a Haiku unit.
- **Do not use Sonnet**, including custom agent types whose definition pins it (such as `sonnet-high`).
- **Fable** runs only as the main session for orchestration, or for hard research the user explicitly assigned to it. Never delegate a unit to it.
- **Always set `model` and `effort` explicitly.** An omitted `model` inherits the main session's model, so a fan-out from a Fable session runs entirely on Fable. Leave `effort` unset only for Haiku units.

## Presets

| Preset | Agent type | Model | Effort |
| --- | --- | --- | --- |
| Search and report | `Explore` | `haiku` | — |
| Implementation | `general-purpose` | `opus` | `medium`; `high` for unfamiliar code, cross-module changes, concurrency or persistent data |
| Independent review | `general-purpose` | `opus` | `high`; `xhigh` for release, security, data-loss or final review |
| Finding verification | workflow stage | `opus` | `medium` |
| Debugging and root cause | `general-purpose` | `opus` | `xhigh` |
| Research | `general-purpose` | `opus` | `medium` for collecting and summarizing; `xhigh` for conflicting evidence or deep comparison |
| Docs and mechanical edits | `general-purpose` | `opus` | `low` |

`Explore` and `Plan` do not receive CLAUDE.md files; other agent types do, so name the specific rule a unit needs instead of pasting the whole policy.

### Search and report

- Brief: the exact question, the search scope, and the output format (`path:line` plus a short quote per hit, and what was searched but not found).
- Forbid recommendations and judgments; the caller interprets the results.

### Implementation

- Brief: objective, acceptance criteria, files or areas in scope, the branch or worktree to work in, constraints (no push, no unrelated edits), and the checks to run.
- Require that every test claimed to guard a fix is shown to fail without the fix.
- Report: status, changes, checks run and not run, open questions, remaining risks.

### Independent review

- Give the target (diff range, branch, PR) and any authoritative spec or acceptance criteria.
- **Withhold the author's rationale and conclusions.** A reviewer handed the author's view tends to confirm it.
- Ask for findings with `file:line`, a concrete failure scenario and the evidence; "no findings" is an acceptable answer. Review is read-only.

### Finding verification

- One unit per finding. Prompt it to refute the finding, defaulting to refuted when the evidence is insufficient.
- Use several independent verifiers or distinct lenses (correctness, security, reproducibility) for high-stakes findings.

### Debugging and root cause

- Brief: the observed failure, reproduction steps, what has been ruled out, and what counts as a confirmed cause.
- Ask for evidence of the cause (a failing check that the fix turns green), not just a plausible story.

### Research

- Brief: the question, the decision it informs, the sources that count, and how time-sensitive the facts are.
- Ask for claims separated from inferences, with sources and dates.

## Escalation

- On repeated failure of the same unit, raise effort one step with the new evidence in the brief; never retry unchanged.
- Use `max` only on user request, or as one step above a failed `xhigh` unit, and say so in the report.
- Never move a unit to Fable on your own judgment. Report the failure evidence and let the user decide.
- If the failure traces to an unclear spec, fix the spec instead; no effort level compensates for an unstated acceptance criterion.

## Workflow presets

Multi-agent workflows still need the user's explicit opt-in. When proposing one, state its shape and the rough agent count.

| Workflow | Shape | Agents |
| --- | --- | --- |
| Review then verify | one independent review per dimension → one finding verification per finding | dimensions + findings |
| Parallel implementation | one implementation unit per issue with `isolation: 'worktree'` → one independent review per result | 2 × issues |
| Broad search sweep | several search-and-report units, each searching a different way → synthesis in the main session | searchers |

Set the preset's fields on every `agent()` call:

```js
agent(reviewPrompt, { label: 'review:correctness', model: 'opus', effort: 'high', schema: FINDINGS })
agent(refutePrompt, { label: `verify:${finding.file}`, model: 'opus', effort: 'medium', schema: VERDICT })
agent(searchPrompt, { label: 'search:config', model: 'haiku', agentType: 'Explore' })
```

## Independent review in a separate session

A subagent inherits CLAUDE.md, and a review inside the authoring session sees its own earlier reasoning. For a review that should challenge the work, start a fresh session in safe mode, which skips CLAUDE.md, auto-memory, skills, plugins, hooks and MCP servers:

```bash
claude --safe-mode -p "Review main...HEAD. Challenge each design decision and report findings with file:line and evidence."
```

- To add skill knowledge, tell it to read the skill file first (for example `~/.claude/skills/vue-best-practices/SKILL.md`) and follow its references. `--plugin-dir` is ignored in safe mode; `--append-system-prompt-file` works for a single file.
- Pass only the target, not the PR description or the author's conclusions.

## Reporting

For each delegated unit, state the preset and the model and effort used, so the choice is reviewable.

## Maintenance

Use model aliases (`opus`, `haiku`, `fable`), which Claude Code resolves to current model IDs. The session default lives in dot-agents' Claude settings (`model` plus `modelSettings.<model>.effortLevel`, keyed by the full model ID); when the Opus generation changes, update both keys together.
