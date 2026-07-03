---
name: commit
description: Disciplined git commit procedure. Use whenever the user asks to commit, when completed work needs to be committed, or before creating a commit for any reason. Covers staging hygiene (no blind add -A), secret and debug-leftover scanning, splitting unrelated changes, and commit message conventions. Do not run git commit without following this procedure.
---

# Commit

A commit is a permanent, reviewable claim that a change is intentional and coherent. This procedure prevents the common failures: committing unverified work, sweeping in unrelated files, leaking secrets, and vague messages.

## When NOT to use

- The user has not asked for a commit and the work does not require one — do not commit proactively.
- Amending or rewriting history — that needs explicit user instruction, not this skill.

## Procedure

1. **Precondition: the change is verified.** For non-trivial changes, the `verify-before-done` checklist must have passed first. Never commit a change whose core claims are unverified; commit messages must not describe behavior you have not observed.

2. **Survey the tree.** Run `git status` and `git diff` (plus `git diff --staged` if anything is already staged). Read the diff file by file. For each file, answer: is this change part of the requested work? Anything you cannot explain does not get committed.

3. **Scan for material that must not be committed:**
   - Secrets: API keys, tokens, private keys, passwords, connection strings, `.env` content. If found, stop and tell the user — do not commit, and flag that a leaked secret may need rotation.
   - Debug leftovers: stray print/log statements, commented-out experiments, temporary files, editor artifacts.
   - Unrelated edits: changes outside the task's scope. Leave them out; mention them to the user separately.

4. **Group into logical commits.** One logical change per commit. Stage by naming files explicitly (`git add <path> ...`); never `git add -A` or `git add .` — blind staging is how secrets and unrelated files get committed. If one file mixes related and unrelated hunks, say so and either split with `git add -p` (where available) or ask the user.

5. **Write the message following the repo's convention.** Check `git log --oneline -10` first and match what you see. Default (matches this dotfiles repo and most projects): Conventional Commits —
   - `type(scope): imperative summary` where type is `feat|fix|docs|refactor|test|chore`.
   - English, imperative mood ("add", not "added"), summary line ≤ 72 chars.
   - Add a body only when the *why* is not obvious from the diff.
   - Append any co-author or attribution trailer the current harness requires.

6. **Commit and report.** Run the commit, then confirm with `git log -1 --stat`. Report the hash and a one-line summary per commit.

## Hard rules

- Never `git push`, `git push --force`, amend, or rebase published commits unless the user explicitly asked for that action in this session.
- Never commit directly over unrelated staged changes you did not review — unstage or review them first.
- Never use `git commit --no-verify` to bypass failing hooks; a failing hook is a failing check and goes in the report.
- If any pre-commit hook modifies files, review the modification, re-stage, and commit again — do not fight the hook.
- If the working tree contains changes you did not make and cannot identify, ask before including or discarding them.
