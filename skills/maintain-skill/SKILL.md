---
name: maintain-skill
description: Create, audit, simplify, update, and validate reusable Agent Skills. Use when working on a SKILL.md, its scripts or references, trigger descriptions, portability across agent harnesses, or deciding whether guidance belongs in a skill.
---

# Maintain Skills

Build the smallest skill that reliably improves a recurring task. Keep the reusable workflow portable; isolate harness-specific integration.

## Principles

- A skill must serve a recognizable, recurring user goal. If ordinary repository instructions or a short prompt are enough, do not create one.
- Skill discovery is an optimization, not a correctness dependency. The underlying task must still be understandable without hidden runtime behavior.
- Prefer one focused skill over a bundle of weakly related procedures.
- Keep `SKILL.md` concise. Load detailed references, examples, and scripts only when needed.
- Use instructions before code. Add a script only for deterministic processing, repeated transformations, or checks that prose cannot perform reliably.
- Do not assume every harness supports the same discovery paths, tools, arguments, subagents, permissions, or frontmatter extensions.
- Preserve useful existing behavior when editing. Remove obsolete machinery only after identifying what it was intended to protect.

## Workflow

### 1. Classify the task

Determine whether the user wants to:

- create a skill;
- change its workflow or output;
- improve discovery or invocation;
- audit portability, safety, or maintainability;
- validate structure; or
- evaluate behavior.

Inspect the existing skill and nearby repository conventions before asking questions. Ask only for missing information that would materially change the result.

For an existing skill, identify:

- its current trigger and promised outcome;
- which files are canonical versus generated;
- portable content versus harness-specific adapters;
- scripts, references, or eval assets that are actually used;
- duplicated, stale, or unverifiable requirements.

### 2. Define the contract

Write down the minimum contract before editing:

- **Goal:** the recurring task this skill improves.
- **Triggers:** requests where loading it adds material value.
- **Non-triggers:** close cases where it should stay out of the way.
- **Inputs:** files, arguments, tools, or context it needs.
- **Output:** observable result or decision it should produce.
- **Boundaries:** when to ask, stop, decline, or defer to project instructions.
- **Dependencies:** required software, network access, or harness features.

Split skills when triggers, inputs, or success criteria differ substantially. Do not split merely to make the directory structure look pure.

### 3. Author the portable core

Every skill is a directory containing `SKILL.md`. Use standard Agent Skills frontmatter:

```yaml
---
name: example-skill
description: Does X for Y. Use when the user asks for Z or provides W.
---
```

Standard fields are:

- required: `name`, `description`;
- optional: `license`, `compatibility`, `metadata`, `allowed-tools`.

Apply these constraints:

- `name` matches the parent directory; use lowercase letters, digits, and single hyphens; maximum 64 characters;
- `description` is non-empty, at most 1024 characters, and states both what the skill does and when it is useful;
- `compatibility`, when needed, is at most 500 characters;
- custom metadata such as a version belongs under `metadata`, not as an invented top-level portable field;
- `allowed-tools` is experimental and may have different effects across clients.

Harness extensions such as invocation controls, argument syntax, execution context, or model selection are not portable. Add them only for an explicit target harness and mark the dependency near the frontmatter or in a dedicated adapter section. Verify the current official documentation before adding or changing one.

Write the body as operational guidance:

1. State decisions and actions in execution order.
2. Include branches only where the choice changes behavior.
3. Name required inputs and observable completion criteria.
4. State important failure and uncertainty handling.
5. Include examples only when they resolve ambiguity.

Avoid generic advice already supplied by the harness or repository. Do not encode fixed planning, delegation, model, or verification policies unless they are intrinsic to this skill's task.

### 4. Add supporting files only when justified

Use conventional directories:

```text
skill-name/
├── SKILL.md
├── references/   # detailed knowledge loaded on demand
├── scripts/      # deterministic helpers
└── assets/       # templates or static inputs
```

- Link supporting files directly from `SKILL.md` and say when to read or run them.
- Keep reference chains shallow.
- Reuse repository tooling and installed dependencies before adding new ones.
- Give scripts a clear usage contract, actionable errors, safe defaults, and a focused validation case.
- Never embed credentials, tokens, private keys, or machine-specific secrets.
- Treat bundled third-party content and executable scripts as supply-chain inputs that require inspection.

### 5. Validate in proportion to the change

Always run the cheapest checks that can catch the likely failure.

#### Structural check

Run the bundled validator by resolving `scripts/validate.mjs` relative to this skill's directory:

```bash
node /path/to/maintain-skill/scripts/validate.mjs /path/to/target-skill
```

Also check referenced paths and any changed script's syntax or focused behavior.

#### Content check

For instruction changes, walk through one realistic task and confirm that the written steps have enough information to reach the promised result. A prose-only edit does not automatically need a benchmark.

#### Trigger check

When changing `name` or `description`, use a small set of realistic examples:

- requests that clearly should trigger;
- near-misses that should not trigger;
- ambiguous requests where another skill may compete.

Test actual discovery in fresh sessions when the target harness provides a practical way to do so. Do not infer trigger quality solely from keywords.

#### Behavioral evaluation

Use isolated with-skill/without-skill comparisons only when the skill is high-impact, expensive, difficult to judge statically, or has shown inconsistent behavior. A useful evaluation records:

- the realistic prompt and inputs;
- the expected observable behavior;
- the result with the skill;
- an appropriate baseline;
- evidence for the conclusion.

Two or three representative cases are usually enough to find obvious gaps. Add repetitions only when measuring variance matters. Use a harness's maintained evaluator when available instead of creating a private benchmark framework by default.

Subagents, blind graders, fixed JSON schemas, token benchmarks, and HTML review pages are optional evaluation techniques. Use them only when supported and when their cost changes the decision.

### 6. Distribute only for a named target

The canonical portable artifact is the skill directory. Installation and packaging are harness concerns.

- Install to a personal or project skill path only when the user requests it.
- Prefer links for a local source of truth only when the harness follows them reliably.
- Use a plugin, archive, marketplace, or generated adapter only when the target's current documentation defines that mechanism.
- Do not invent a `.skill` package format or package every successful edit.
- Keep generated adapters reproducible and label them as generated.

### 7. Report

Summarize:

- the contract or behavior changed;
- portable versus harness-specific decisions;
- files added, retained, or removed and why;
- validation performed and observed result;
- discovery or runtime behavior not directly tested;
- remaining compatibility limits.

## Audit Checklist

- The skill still needs to exist and has one coherent goal.
- The description states both capability and trigger conditions.
- The directory name and frontmatter name agree.
- The body is concise, executable, and free of stale harness assumptions.
- Supporting files are referenced and useful.
- Scripts earn their maintenance and security cost.
- Harness-specific fields are explicit and documented.
- Validation matches the change's risk.
- Packaging and elaborate eval infrastructure are not present without a current use case.

## Current References

Verify version-sensitive behavior against primary sources:

- Agent Skills specification: https://agentskills.io/specification
- Codex skills documentation: https://developers.openai.com/codex/skills
- Claude Code skills documentation: https://code.claude.com/docs/en/skills
- Antigravity skills documentation: https://antigravity.google/docs/skills
