---
name: orbit-domain-awareness
description: "Domain language enforcement for Orbit rounds. Defines how to discover, challenge, and maintain CONTEXT.md glossary and ADR files throughout the Orbit workflow."
---

# Domain Awareness

This skill defines the authoritative rules for domain language enforcement within the Orbit workflow. Every Orbit agent that interacts with domain concepts MUST read and follow these rules.

## Discovering Domain Documentation

Look for these files at the project root:

- **`CONTEXT-MAP.md`** — If present, the repo has multiple bounded contexts. Read the map to discover where each `CONTEXT.md` lives and which context the current task relates to. If unclear, ask the user.
- **`CONTEXT.md`** — The project's ubiquitous language glossary: defined terms, aliases to avoid, relationships, and flagged ambiguities.
- **`docs/adr/`** — Architecture Decision Records. Read existing ADRs to understand past trade-offs that constrain the current task.

If none of these exist yet, that is fine — they will be created lazily when the first term or decision is resolved.

### Single vs Multi-Context Repos

**Single context (most repos):** One `CONTEXT.md` at the repo root.

**Multiple contexts:** A `CONTEXT-MAP.md` at the repo root lists the contexts, where they live, and how they relate. When multiple contexts exist, infer which one the current topic relates to. If unclear, ask.

## Interrogation Behaviors

Apply these behaviors throughout Clarify (and whenever new terminology surfaces in later phases):

1. **Challenge against the glossary.** When the user uses a term that conflicts with `CONTEXT.md`, call it out immediately: "Your glossary defines 'X' as A, but you seem to mean B — which is it?"
2. **Sharpen fuzzy language.** When the user uses vague or overloaded terms, propose a precise canonical term: "You're saying 'account' — do you mean the Customer or the User? Those are different things."
3. **Discuss concrete scenarios.** When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.
4. **Cross-reference with code.** When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code does X, but you just said Y — which is right?"

## Domain Draft Capture (Clarify Phase)

Round itself never writes substantive file edits. The rules below govern what Round **drafts** into `requirements.md` during Clarify; actual writes to `CONTEXT.md` and `docs/adr/` are always delegated to `Orbit Execute` in Phase 3.

- **Draft `CONTEXT.md` updates inline.** When a term is resolved during Clarify, capture the update in the requirements as it happens — don't batch them.
- **Offer ADRs sparingly.** Only offer to create an ADR when **all three** criteria are true:
  1. **Hard to reverse** — the cost of changing your mind later is meaningful.
  2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
  3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons.

  If any of the three is missing, skip the ADR.

Note: `CONTEXT.md` and ADR edits are substantive edits — they MUST be delegated to `Orbit Execute` as part of the plan, not performed by Round directly. During Clarify, **draft** the updates in the requirements, then include them as plan steps.

## Planning Usage

Before generating the plan, check whether the project has domain documentation:

- Read `CONTEXT.md` (or `CONTEXT-MAP.md` → relevant context's `CONTEXT.md`) if it exists.
- Read existing `docs/adr/*.md` if the task touches areas covered by ADRs.

Use the glossary terms in every plan step description. If the requirements include drafted `CONTEXT.md` updates or ADR content from Clarify, translate them into concrete plan steps specifying the exact file path, the content to write, and how to verify the update.

## Execution Maintenance

When the plan includes `CONTEXT.md` or ADR updates:

### CONTEXT.md Format

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others as aliases to avoid.
- **Flag conflicts explicitly.** If a term was used ambiguously, record the resolution in "Flagged ambiguities".
- **Keep definitions tight.** One sentence max. Define what it IS, not what it does.
- **Show relationships** with bold term names and cardinality.
- **Only include terms specific to this project's context.** General programming concepts don't belong.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.
- **Write an example dialogue** demonstrating how terms interact naturally.

### ADR Format

ADRs live in `docs/adr/` with sequential numbering (`0001-slug.md`). An ADR can be a single paragraph — the value is recording _that_ a decision was made and _why_. Only add optional sections (Status, Considered Options, Consequences) when they add genuine value.

Scan `docs/adr/` for the highest existing number and increment by one.

### Create Lazily

If `CONTEXT.md` doesn't exist, create it only when the first term is resolved. If `docs/adr/` doesn't exist, create it only when the first ADR is needed.

## Review Verification

When reviewing code changes, verify domain language consistency:

- If the project has a `CONTEXT.md`, verify that new or changed identifiers, UI labels, log messages, comments, and documentation use the canonical terms from the glossary.
- Flag any introduced term that conflicts with or duplicates an existing glossary entry.
- If `CONTEXT.md` or ADR files were created/updated as part of the round, verify they follow the documented format (tight definitions, explicit aliases to avoid, relationships with cardinality, ADR three-criteria gate).
