---
name: orbit-memory-ops
description: "Memory format, operations, and index management for Orbit long-term memory. Defines the authoritative rules for search, archive, ID generation, and index maintenance."
---

# Memory Operations

This skill defines the authoritative rules for long-term memory management within the Orbit workflow. Every Orbit agent that interacts with `.orbit/memories/` MUST read and follow these rules.

## Memory Location

All memories live in `.orbit/memories/`. The index is at `.orbit/memories/index.json`.

## Memory File Format

Every memory file MUST follow this format:

```markdown
---
id: MEM_YYYYMMDD_NNN
title: "Concise memory title"
date: YYYY-MM-DD
tags: [tag1, tag2, tag3]
abstract: "1-2 sentence high-level description of the technical value of this memory."
---

# Detailed Content

<structured content derived from the round summary>
```

## ID Generation

- Format: `MEM_YYYYMMDD_NNN` where `NNN` is a zero-padded sequential number for that date.
- Read `index.json` to find the highest existing ID for today's date and increment.

## Index Format

The `index.json` file tracks all memories for fast lookup:

```json
{
  "version": 1,
  "memories": [
    {
      "id": "MEM_20260419_001",
      "title": "Memory title",
      "date": "2026-04-19",
      "tags": ["tag1", "tag2"],
      "abstract": "Brief description.",
      "file": "MEM_20260419_001.md"
    }
  ]
}
```

## Operations

### Search

1. Read `index.json`.
2. Filter memories by matching query against `title`, `tags`, and `abstract` fields.
3. For promising matches, read the full `.md` file to confirm relevance.
4. Return ranked results with relevance reasoning.

### Archive

1. Read `index.json` to determine the next ID.
2. Analyze the round summary to extract:
   - A concise title summarizing the key outcome.
   - Relevant tags (technical domains, patterns, tools involved).
   - A 1–2 sentence abstract capturing the technical value.
   - Structured detailed content (decisions made, approaches taken, lessons learned).
3. Check for duplicates — do not create a new memory when an existing one covers the same ground. When a duplicate is detected, the archive short-circuits with `index_updated: false` and returns the existing memory's metadata with `duplicate: true` (see Archive Result Contract below).
4. Create the memory `.md` file with proper frontmatter.
5. Update `index.json` to include the new entry.
6. Return the created memory's metadata.

## CLI Commands

```bash
# List all memories
node .orbit/scripts/cli.mjs memory-list

# Search memories
node .orbit/scripts/cli.mjs memory-search "<query>"

# Archive a new memory (inline body; safe only for single-line content)
node .orbit/scripts/cli.mjs memory-archive --title "..." --tags "t1,t2" --abstract "..." --body "..."

# Archive a new memory (preferred for real round summaries)
# --body-file points at a file whose contents become the memory body.
# Prefer this form whenever the body contains newlines, code fences,
# or quotes — shell-escaping an inline --body is fragile and can
# truncate or mangle content.
node .orbit/scripts/cli.mjs memory-archive --title "..." --tags "t1,t2" --abstract "..." --body-file <path>
```

## Workflow Integration

### Round Dispatches Memory Manager (Search)

- **Phase 1 (Clarify)**: Round dispatches Memory Manager in **search mode** with keywords derived from the user's request. Surface any relevant past memories alongside terms or ADRs.

### Next Advisor Dispatches Memory Manager (Archive)

- **Post-Round**: After writing `summary.md`, Next Advisor dispatches Memory Manager in **archive mode** with the round's summary, state, and plan.

### Search Result Contract

```json
{
  "status": "search_complete",
  "operation": "search",
  "query": "<original query>",
  "results": [
    {
      "id": "MEM_YYYYMMDD_NNN",
      "title": "...",
      "abstract": "...",
      "relevance": "<why this matched>",
      "file": "<filename>"
    }
  ],
  "total_memories_scanned": 0
}
```

### Archive Result Contract

```json
{
  "status": "archive_complete",
  "operation": "archive",
  "memory": {
    "id": "MEM_YYYYMMDD_NNN",
    "title": "...",
    "date": "YYYY-MM-DD",
    "tags": ["..."],
    "abstract": "...",
    "file": "<filename>"
  },
  "index_updated": true
}
```

When a duplicate was detected (no new entry created):

```json
{
  "status": "archive_complete",
  "operation": "archive",
  "memory": {
    "id": "MEM_YYYYMMDD_NNN",
    "file": "<filename>",
    "duplicate": true
  },
  "index_updated": false
}
```

### Error Contract

```json
{
  "status": "error",
  "operation": "search | archive",
  "error": "<description of what went wrong>",
  "partial_result": null
}
```

## Anti-Patterns

- **Shallow summaries**: Extracting only a title without capturing decisions and lessons.
- **Tag spam**: Using too many or too generic tags (e.g., "code", "work").
- **Duplicate memories**: Creating a new memory when an existing one covers the same ground.
- **Index drift**: Forgetting to update `index.json` after creating a memory file.
- **Scope violation**: Touching files outside `.orbit/memories/`.
