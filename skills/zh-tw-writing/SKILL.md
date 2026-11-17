---
name: zh-tw-writing
description: Write, translate, localize, edit, or review substantial Taiwan Traditional Chinese text. Use for articles, posts, product or UX copy, documentation, announcements, and requests to remove formulaic AI writing or unnatural Mainland/translationese phrasing. Ordinary conversation already follows the always-on communication preferences; do not load the full guide for routine answers.
---

# Natural Taiwan Traditional Chinese Writing

Help produce clear, idiomatic zh-TW text for the actual audience. This is an editing playbook, **not** an AI authorship detector or an unconditional word blacklist. The always-on rules in `preferences/communication.md` apply to *all* user-facing responses without this skill.

## Trigger / scope

Use for drafting or materially revising prose, localization, translation, tone review, or editorial consistency checks. For a brief everyday reply, answer directly under the global communication core; do not load the large references by default. Honor user-specified style, project terminology, and the original author's voice.

## Workflow

1. **Identify constraints.** Determine audience (technical or general), medium, intended tone, and repository or product glossary. Confirm which text is source material versus commentary. If the user only requests a translation, preserve its intent and degree of certainty.
2. **Protect meaning first.** Retain facts, numbers, names, commands, paths, identifiers, direct quotes, legal qualifications, claims, and uncertainty. Do not invent evidence, personal anecdotes, or completed actions.
3. **Localize with context.** Use natural Taiwan phrasing, not literal Simplified-to-Traditional conversion. Keep common English technical terms when Taiwan readers naturally use them (e.g. API, SDK, PR, commit); prefer established Taiwan translations where natural (e.g. 資料庫, 快取, 伺服器). Do not blindly substitute ambiguous words such as 質量, 程序, 函數, 文件, token, or deployment.
4. **Reduce template language.** Remove hollow introductions/closings, false contrasts ("不是 X，而是 Y" without a useful distinction), repetitive praise, vague jargon, excess structure, and bureaucratic translationese. Preserve rhetorical figures that genuinely clarify the argument or match the requested voice.
5. **Verify the rewrite.** Compare before and after for meaning, technical accuracy, terminology consistency, factual claims, tone, and readability. If the user requested an audit, give concrete findings and suggested edits; if the user requested a revised text, provide the revised text rather than only advice.

## Load only the relevant reference

- Repetitive AI-styled rhetoric, boilerplate structure, marketing jargon, translationese: [references/ai-patterns.md](references/ai-patterns.md).
- Taiwan everyday and software terminology, including exceptions: [references/taiwan-terminology.md](references/taiwan-terminology.md).
- English terminology that is often better left untranslated in Taiwan: [references/english-terms.md](references/english-terms.md).
- Hallucination checks, typography, editorial review order, model evidence limits, and sources: [references/quality-and-sources.md](references/quality-and-sources.md).

The references retain **278 contextual Don't / Do examples** from the 2026-11-17 working guide. They are not categorical bans, and the model-comparison notes are limited by their source corpus. Do not promise measured quality improvements without a baseline or controlled evaluation.

## Completion criteria

- The result reads naturally to its intended Taiwanese audience.
- Meaning, identifiers, verifiable claims, and uncertainty are preserved.
- English terms and Taiwan translations follow audience and project convention.
- Editorial suggestions are specific, not generic "AI-detector" claims.
