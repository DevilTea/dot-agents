---
name: maintain-skill
description: Create, modify, test, and optimize agent skills. Use when creating a skill from scratch, editing or improving an existing skill, running evals, benchmarking skill quality, or packaging skills for distribution.
---

# Skill Creator

A skill for creating, testing, and iteratively improving agent skills — optimized for VS Code GitHub Copilot's tool and subagent ecosystem.

## High-Level Process

1. **Deep Intent Capture** — Grill-me style interview to thoroughly understand the skill's purpose
2. **Draft** — Write the SKILL.md and supporting files
3. **Test** — Create test cases and run them via subagents
4. **Evaluate** — Grade outputs quantitatively and qualitatively with HTML reviewer
5. **Iterate** — Improve based on feedback, repeat until satisfied
6. **Validate & Package** — Final checks and packaging

Your job is to figure out where the user is in this process and jump in. Maybe they want to start from scratch, or maybe they have a draft that needs testing. Be flexible — but always know which phase you're in.

## Communication Style

Pay attention to context cues about the user's technical level. When in doubt, briefly explain terms like "assertion", "benchmark", or "JSON schema". Use `vscode_askQuestions` for structured choices. For open-ended exploration, use natural conversation.

---

## Phase 1: Deep Intent Capture (Grill-Me Interview)

Before writing any code, interview the user relentlessly about every aspect of their skill idea. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

### Core Principles

1. **Extract from context first.** If the conversation already contains a workflow the user wants to capture ("turn this into a skill"), extract answers from history — tools used, step sequence, corrections made, I/O formats observed. Don't re-ask what's already clear.

2. **Explore instead of asking.** If a question can be answered by reading the codebase or docs, use `runSubagent` with "Explore" agent instead of burdening the user.

3. **Resolve before advancing.** Don't move to the next topic until the current one has shared understanding. Summarize your understanding and confirm.

4. **Structured when possible.** Use `vscode_askQuestions` for choices with clear options. Reserve open conversation for ambiguous topics.

### Decision Tree

Walk through these branches systematically. Skip what's already clear.

**What & Why**

- What should this skill enable the model to do?
- What problem does it solve? Why can't the model do this well without specific instructions?
- What's the expected output format?

**When & Trigger**

- When should this skill activate? What user phrases or contexts?
- When should it explicitly NOT trigger? What adjacent tasks should be excluded?
- How "pushy" should the description be? (LLMs tend to under-trigger skills — leaning pushy usually helps.)

**How & Workflow**

- What specific steps should the model follow?
- Are there deterministic tasks that should be scripts? (If the model would independently write the same helper every time, bundle it.)
- What tools will the skill rely on? (`run_in_terminal`, `read_file`, `runSubagent`, `vscode_askQuestions`, etc.)
- External dependencies? (npm packages, APIs, CLIs)

**Edge Cases & Constraints**

- What errors could occur? How should they be handled?
- Input format variations?
- What should the skill explicitly NOT do?
- Performance or output size constraints?

**Testing Strategy**

- Should we set up test cases? (Recommend for objectively verifiable outputs; skip for subjective ones like writing style.)
- What does "success" look like concretely?
- Quantitative assertions, qualitative review, or both?

Use `vscode_askQuestions` for structured decision points:

```
vscode_askQuestions({
  questions: [
    {
      header: "Testing approach",
      question: "How should we evaluate this skill's outputs?",
      options: [
        { label: "Quantitative — with automated assertions", recommended: true },
        { label: "Qualitative — human review only" },
        { label: "Both — assertions plus human review" },
        { label: "Skip testing — just iterate by feel" }
      ]
    }
  ]
})
```

### Research Phase

Before finalizing the design:

- Search for existing similar skills: `file_search('**/SKILL.md')`
- Look for relevant patterns in the user's codebase via "Explore" subagent
- Check if there are reference docs or repos worth learning from

---

## Phase 2: Write the SKILL.md

### Skill Directory Structure

```
skill-name/
├── SKILL.md            # Required — YAML frontmatter + markdown instructions
├── scripts/            # Executable scripts for deterministic/repetitive tasks
├── references/         # Docs loaded into context on demand
└── assets/             # Templates, fonts, static files
```

### YAML Frontmatter

```yaml
---
name: kebab-case-name
description: >
  Imperative description focused on user intent, not implementation.
  Include trigger phrases AND broader intent categories.
  Be slightly "pushy" to combat under-triggering.
  Max 1024 characters.
---
```

The `description` is the primary triggering mechanism. Tips:

- Use imperative form: "Use this skill when..." not "This skill does..."
- Focus on what the user is trying to achieve
- Make it distinctive among competing skills
- Include edge cases that should trigger it

### Progressive Disclosure

Three loading levels:

1. **Metadata** (name + description) — Always in context (~100 words)
2. **SKILL.md body** — Loaded when triggered (<500 lines ideal)
3. **Bundled resources** — On demand (unlimited; scripts execute without loading)

Guidelines:

- Keep SKILL.md under 500 lines. Extract to reference files with clear pointers when longer.
- Reference files >300 lines should include a table of contents.
- Multi-domain skills: organize by variant (`references/aws.md`, `references/gcp.md`).

### Writing Patterns

- **Imperative form**: "Extract the text" not "The skill extracts text"
- **Explain WHY**: Reasoning beats rigid rules. LLMs have good theory of mind — understanding motivation produces better results than mechanical compliance.
- **Avoid all-caps MUSTs**: If you're tempted to write "ALWAYS" or "NEVER", reframe as explanation of why it matters.
- **Include examples** for output formats and tricky patterns.
- **Define templates** with explicit structure when output format matters.

### Scripts

When the skill bundles scripts:

- Use Node.js ESM (`.mjs`) as the default runtime
- Minimize dependencies — prefer Node built-ins (`fs`, `path`, `http`, `crypto`, `child_process`)
- When npm packages are needed, include a `package.json` in `scripts/` and document install steps
- Make scripts standalone: `node scripts/my-script.mjs <args>`

### Security

Skills must not contain malware, exploit code, or content that could compromise system security. A skill's contents should not surprise the user. Don't create misleading skills or skills designed to facilitate unauthorized access.

---

## Phase 3: Test Cases

After writing the skill draft, create 2–3 realistic test prompts — the kind of thing a real user would actually say. Share them with the user: "Here are test cases I'd like to try. Do these look right, or should we add more?"

Save them as an iteration-local snapshot at `<workspace>/iteration-N/evals.json`:

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "dir_name": "descriptive-eval-name",
      "prompt": "User's realistic task prompt",
      "expected_output": "Description of expected result",
      "files": [],
      "expectations": []
    }
  ]
}
```

The `dir_name` field must match the directory name used for this eval under each iteration folder (e.g. `iteration-1/descriptive-eval-name/with_skill/`). The review generator and benchmark aggregator use the iteration-local `evals.json` snapshot to map prompts and expectations to runs.

Treat this file as frozen metadata for that iteration. If you start `iteration-2`, copy the previous iteration's `evals.json` forward first, then edit the new copy.

Don't write assertions yet — just prompts. Assertions come in the next phase while runs are in progress.

### Writing Good Expectations

When you draft assertions (in Phase 4 Step 2), avoid vague "presence checks" that can be satisfied by fabricated content. The without-skill baseline will often generate plausible-looking but factually wrong output. Your expectations must distinguish correct from plausible-but-wrong.

**Bad**: "展示至少兩個 plugin lifecycle hook"
— A model without the skill can invent plausible-sounding hook names that don't actually exist.

**Good**: "展示至少兩個正確的 PikaCSS plugin lifecycle hook（例如 configureRawConfig, configureEngine, transformStyleItems）"
— Specifies real hook names; fabricated ones will fail.

**Bad**: "提到 variables 的設定方式"
— Any vaguely related config structure would pass.

**Good**: "使用 variables.variables 巢狀物件結構定義 CSS variables，並從 @pikacss/core 匯入 defineEngineConfig"
— Anchors to specific API surface; wrong import paths or config shapes will fail.

Rules of thumb:

- Include **correct API names, import paths, or data structures** in the expectation text
- If the skill teaches a specific pattern, assert that exact pattern — not just the concept
- If something has only one correct form (an import path, a function name), name it explicitly

See `references/schemas.md` for the full schema.

---

## Phase 4: Run and Evaluate

This is one continuous sequence — don't stop partway through.

Organize results in `<skill-name>-workspace/` as a sibling to the skill directory, by iteration (`iteration-1/`, `iteration-2/`, etc.).

### Step 1: Spawn all runs via subagents

For each test case, spawn two subagents — one with the skill, one without. The isolation rules below are critical for valid measurement.

#### Context Isolation

Subagents inherit the parent conversation's system context (AGENTS.md, skill descriptions, repo memory, user memory). This shared context contaminates both runs equally. To produce a meaningful delta, enforce these constraints **in the subagent prompt itself**:

**With-skill run** — allowed to:

- Read the skill file and any reference files the skill directs
- Read input files listed in the eval
- Write output files

**With-skill run** — forbidden from:

- Reading workspace source code, docs, examples, or demo projects beyond what the skill references provide
- Using `search_subagent`, `semantic_search`, `grep_search`, `file_search`, or `list_dir` to explore the codebase
- Running terminal commands that read codebase files (cat, grep, find, etc.)

Rationale: the skill's value is measured by how well its bundled knowledge replaces codebase exploration. If the with-skill run also reads source code, you can't attribute the result to the skill.

**Baseline run** — allowed to:

- Write output files
- Read input files listed in the eval

**Baseline run** — forbidden from:

- Reading ANY workspace files (source code, docs, examples, configs, demo projects, test files)
- Using `read_file`, `search_subagent`, `semantic_search`, `grep_search`, `file_search`, `list_dir`, or `run_in_terminal` for codebase exploration
- Reading any skill files (including the skill being tested)

Rationale: the baseline measures what the model can produce from its intrinsic training knowledge alone. Any codebase access gives the baseline near-skill-quality knowledge and collapses the delta.

#### Prompt Templates

**With-skill run:**

```
runSubagent({
  prompt: `You are executing an isolated skill evaluation. Follow these rules strictly:

ALLOWED: Read the skill file and its reference files. Read input files listed below. Write output files.
FORBIDDEN: Do NOT read any workspace source code, docs, examples, or demo projects. Do NOT use search_subagent, semantic_search, grep_search, file_search, or list_dir to explore the codebase. Do NOT run terminal commands that read codebase files. Only use knowledge from the skill files and your own training data.

First, read the skill at <path>/SKILL.md, then load any reference files it directs you to. Then execute this task using ONLY the skill's knowledge and your own training data.

Task: <prompt>
Input files: <files or "none">
Save all outputs to: <workspace>/iteration-N/<eval-name>/with_skill/outputs/
Write a step-by-step transcript to: <workspace>/iteration-N/<eval-name>/with_skill/transcript.md
At the end, write a metrics summary to: <workspace>/iteration-N/<eval-name>/with_skill/outputs/metrics.json with keys: tool_calls (object counting each tool type), total_tool_calls, files_created, errors_encountered.`,
  description: "Run eval with skill"
})
```

**Baseline run:**

```
runSubagent({
  prompt: `You are executing an isolated baseline evaluation. Follow these rules strictly:

ALLOWED: Write output files. Read input files listed below.
FORBIDDEN: Do NOT read ANY files in the workspace — no source code, no docs, no examples, no configs, no test files, no demo projects, no skill files. Do NOT use read_file, search_subagent, semantic_search, grep_search, file_search, list_dir, or run_in_terminal for any codebase exploration. You must answer using ONLY your own training knowledge.

Task: <prompt>
Input files: <files or "none">
Save all outputs to: <workspace>/iteration-N/<eval-name>/without_skill/outputs/
Write a step-by-step transcript to: <workspace>/iteration-N/<eval-name>/without_skill/transcript.md
At the end, write a metrics summary to: <workspace>/iteration-N/<eval-name>/without_skill/outputs/metrics.json with keys: tool_calls (object counting each tool type), total_tool_calls, files_created, errors_encountered.`,
  description: "Run eval baseline"
})
```

**Baseline strategy:**

- Creating a new skill: no skill at all.
- Improving an existing skill: snapshot the old version first, use that as baseline.

Use the `dir_name` field in `<workspace>/iteration-N/evals.json` to map each eval to its iteration directory. The eval directory structure should be:

```
iteration-N/
  <dir_name>/
    with_skill/
      outputs/
      transcript.md
    without_skill/
      outputs/
      transcript.md
```

The review generator (`generate-review.mjs`) looks up prompts and expectations from the current iteration's `evals.json` by matching directory names to `dir_name`. You don't need to write `eval_metadata.json` files unless you want to override per-run metadata.

### Step 2: Draft assertions while runs execute

Use this time productively. Draft quantitative assertions for each test case:

- Objectively verifiable
- Descriptive names (readable in benchmark viewer)
- Not trivially satisfied by wrong output
- **Correctness-anchored**: Include specific API names, import paths, or data structures that only correct answers would contain (see Phase 3 "Writing Good Expectations")

Subjective skills are better evaluated qualitatively — don't force assertions.

Update the current iteration's `evals.json` with the drafted assertions.

### Step 3: Grade each run

Each run must be graded by a **dedicated grader subagent**, not by the orchestrator inline. This separation is critical:

- The orchestrator already knows the expected answers and the skill content, creating confirmation bias.
- The grader agent follows a multi-step protocol (contamination check, claim extraction, eval critique) that gets skipped when grading is done inline.
- Grading.json files produced inline tend to be missing required fields (`execution_metrics`, `timing`, `claims`, `eval_feedback`).

Read `agents/grader.md` first, then paste its full content into each grader subagent prompt. Do NOT summarize or abbreviate the grader instructions.

Spawn one grader subagent per run (8 runs = 8 grader subagents). Independent runs can be graded in parallel.

```
runSubagent({
  prompt: `You are a grader agent. Follow the grading protocol below EXACTLY — execute every step (1 through 7), produce every field in the output format.

<grader-protocol>
<paste the FULL content of agents/grader.md here — do not summarize>
</grader-protocol>

Grade this run:
- Run type: <"with_skill" or "without_skill (baseline)">
- Expectations: <JSON array of expectation strings>
- Transcript: <path>/transcript.md
- Outputs directory: <path>/outputs/
- Save results to: <path>/grading.json

The expectations array MUST use exactly these fields: text, passed, evidence.
The output MUST include all top-level keys: expectations, summary (with pass_rate), contamination, execution_metrics, timing, claims, user_notes_summary, eval_feedback.`,
  description: "Grade <eval-name> <run-type>"
})
```

**Self-check before proceeding to Step 4**: Verify that grading was done via subagents. If you wrote grading.json files directly without spawning grader subagents, STOP and redo this step correctly.

For assertions checkable programmatically, write and run a script — faster, more reliable, reusable.

### Step 4: Aggregate and launch review

1. **Aggregate** into benchmark stats:

   ```bash
   node <maintain-skill-path>/scripts/aggregate-benchmark.mjs <workspace>/iteration-N --skill-name <name>
   ```

   Produces `benchmark.json` and `benchmark.md`.

2. **Generate review HTML**:

   ```bash
   node <maintain-skill-path>/scripts/generate-review.mjs <workspace>/iteration-N --skill-name "my-skill"
   ```

   For iteration 2+, add: `--previous-workspace <workspace>/iteration-<N-1>`

   This writes a self-contained HTML file and opens it. The user can navigate outputs, see grades, and leave feedback.

3. **Tell the user**: "I've opened the results in your browser. The 'Outputs' tab shows each test case with feedback boxes. The 'Benchmark' tab shows quantitative comparison. Come back when you're done reviewing."

### Step 5: Read feedback

When the user returns, read `feedback.json` in the workspace directory. Empty feedback means things looked fine. Focus improvements on test cases with specific complaints.

---

## Phase 5: Iterate

### Improvement Philosophy

1. **Generalize from feedback.** Don't overfit to specific test cases. The skill will be used across many different prompts — fiddly, narrow changes are counterproductive.

2. **Keep instructions lean.** Read transcripts, not just outputs. If the skill makes the model waste time on unproductive steps, remove those instructions.

3. **Explain the why.** Try to understand what the user actually wants and transmit that understanding into the instructions. Reasoning > mechanical rules.

4. **Extract repeated patterns.** If all test runs independently wrote similar helper scripts, bundle that script in the skill's `scripts/` directory.

5. **Draft then refine.** Write a draft revision, then look at it with fresh eyes and improve. The quality bar here is high — these instructions get reused across potentially many invocations.

### The Loop

1. Apply improvements to the skill
2. Rerun all test cases into `iteration-<N+1>/`, including baselines
3. Generate review with `--previous-workspace` pointing at previous iteration
4. Wait for user feedback
5. Repeat

Stop when:

- The user says they're happy
- All feedback is empty
- No meaningful progress between iterations

---

## Phase 6: Validate & Package

### Validation

```bash
node <maintain-skill-path>/scripts/validate.mjs <path/to/skill>
```

Checks: SKILL.md existence, frontmatter format, required fields, kebab-case naming, description length (≤1024 chars), no angle brackets in description.

### Packaging

```bash
node <maintain-skill-path>/scripts/package-skill.mjs <path/to/skill> [output-dir]
```

Creates a `.skill` file (zip archive) excluding `node_modules/`, `__pycache__/`, `.DS_Store`, `evals/`, and build artifacts.

---

## Advanced: Blind Comparison

For rigorous A/B comparison between two skill versions, use the blind comparison system. Read `agents/comparator.md` for blind judging protocol and `agents/analyzer.md` for post-hoc analysis of why one version beat another.

This is optional and most users won't need it. The human review loop is usually sufficient.

---

## Advanced: Description Optimization

The description field determines whether the skill gets triggered. After the skill is working well, optimize it.

### Step 1: Generate trigger eval queries

Create ~20 realistic queries — about half should-trigger, half should-not. Focus on edge cases, not obvious ones.

Good queries are specific and detailed, like something a real user would type:

- Include file paths, personal context, column names, URLs
- Mix of formal/casual, different lengths
- Some with typos or abbreviations

Should-not-trigger queries should be near-misses — queries sharing keywords but needing something different. Avoid obviously irrelevant queries.

### Step 2: Review with user

Use the eval-review HTML template:

1. Read `assets/eval-review.html`
2. Replace placeholders: `__EVAL_DATA_PLACEHOLDER__`, `__SKILL_NAME_PLACEHOLDER__`, `__SKILL_DESCRIPTION_PLACEHOLDER__`
3. Write to temp file and open it
4. User edits queries, toggles should-trigger, exports JSON

### Step 3: Manual optimization

Without a CLI tool for automated triggering tests, iterate manually:

- Review which queries the current description would likely hit/miss
- Analyze failure patterns — generalize, don't list specific queries
- Rewrite description: imperative form, focus on user intent, ≤1024 chars, distinctive
- Use `vscode_askQuestions` to confirm each revision with the user

---

## Reference Files

- `agents/grader.md` — Evaluate assertions against outputs
- `agents/comparator.md` — Blind A/B comparison between outputs
- `agents/analyzer.md` — Post-hoc analysis of why one version beat another
- `references/schemas.md` — JSON schemas for evals.json, grading.json, benchmark.json, etc.
- `scripts/validate.mjs` — Validate SKILL.md structure
- `scripts/aggregate-benchmark.mjs` — Aggregate grading results into benchmark stats
- `scripts/generate-review.mjs` — Generate self-contained HTML review page
- `scripts/package-skill.mjs` — Package skill into .skill zip file
- `assets/eval-review.html` — HTML template for trigger eval query review

---

**Core loop reminder — use `manage_todo_list` to track progress:**

1. Interview thoroughly (grill-me style) before writing anything
2. Draft the skill
3. Run test prompts via subagents
4. Generate HTML review for the user (always do this before iterating yourself!)
5. Read feedback and improve
6. Validate and package
