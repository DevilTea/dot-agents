# Requirements — Replace "cycle" with "round" in Agent Descriptions

## Context

CONTEXT.md lists "cycle" as an avoided alias for **Round**. Four agent files still use "cycle" in descriptions and topology comments.

## Scope

Six occurrences across four files:

| #   | File                                               | Line | Current                  | Replacement              |
| --- | -------------------------------------------------- | ---- | ------------------------ | ------------------------ |
| 1   | `plugins/orbit/agents/Orbit.agent.md`              | 3    | "for each task cycle"    | "for each round"         |
| 2   | `plugins/orbit/agents/Orbit.agent.md`              | 7    | "for each cycle of work" | "for each round of work" |
| 3   | `plugins/orbit/agents/Orbit.agent.md`              | 14   | "(…Review cycle)"        | "(…Review round)"        |
| 4   | `plugins/orbit/agents/Orbit Backlog.agent.md`      | 14   | "(…Review cycle)"        | "(…Review round)"        |
| 5   | `plugins/orbit/agents/Orbit Next Advisor.agent.md` | 15   | "(…Review cycle)"        | "(…Review round)"        |
| 6   | `plugins/orbit/agents/Orbit Round.agent.md`        | 213  | "3 auto-fix cycles"      | "3 auto-fix attempts"    |

## Constraints

- Text-only changes — no behavioral or structural modification.
- Replacement wording must read naturally in context.
- No other files affected.

## Domain Artifacts

No new CONTEXT.md or ADR updates needed — this task enforces the existing glossary.

## Mode

**simple** — single-concern cosmetic cleanup, low risk.
