---
name: orbit-memory-ops
description: "Memory format, operations, and index management for Orbit long-term memory. Defines the authoritative rules for search, reconciliation, ID generation, and index maintenance."
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

## Candidate Memory Artifact

Rounds keep a round-local candidate memory artifact at `candidate-memories.json` inside the round directory.

```json
{
  "version": 1,
  "candidates": [
    {
      "id": "CAND_001",
      "title": "Concise candidate title",
      "tags": ["orbit", "memory"],
      "abstract": "1-2 sentence candidate summary.",
      "body": "# Detailed note\n\nCandidate content.",
      "sourcePhase": "clarify | planning | execute | review",
      "notedAt": "2026-04-21T10:20:48.000Z",
      "status": "pending | archived | updated",
      "resolution": null
    }
  ],
  "lastReconciledAt": null
}
```

Any phase may append a new candidate entry immediately when something becomes worth remembering. Candidates are promoted, updated, or discarded only during end-of-round Memory Reconciliation.

## Operations

### Search

1. Read `index.json`.
2. Filter memories by matching query against `title`, `tags`, and `abstract` fields.
3. For promising matches, read the full `.md` file to confirm relevance.
4. Return ranked results with relevance reasoning.

### Reconcile

1. Read `candidate-memories.json`, `index.json`, the round summary, and any related memory files needed for context.
2. For each candidate, decide whether to:

- **Archive** it as a new long-term memory.
- **Update** an existing long-term memory when the candidate supersedes or corrects it.
- **Leave it pending** when the round did not produce enough evidence to promote it yet.

3. Delete stale superseded memories when the newer candidate or updated memory fully replaces them. This deletion is authorized only during Reconciliation.
4. After all applied actions, validate that `index.json` still has unique IDs/files and references only files that exist on disk.
5. Return the applied actions, pending candidate count, and index validation result.

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

# Append a round-local candidate memory
node .orbit/scripts/cli.mjs memory-candidate-add <roundPath> --title "..." --tags "t1,t2" --abstract "..." --body-file <path> --phase execute

# Reconcile candidate memories into long-term memory
node .orbit/scripts/cli.mjs memory-reconcile <roundPath> --operations-file <path>
```

## Workflow Integration

### Round Dispatches Memory Manager (Search)

- **Phase 1 (Clarify)**: Round dispatches Memory Manager in **search mode** with keywords derived from the user's request. Surface any relevant past memories alongside terms or ADRs.

### Round Dispatches Memory Manager (Reconcile)

- **Post-Review close-out**: After writing `5_summary.md`, Round dispatches Memory Manager in **reconcile mode** with the round's candidate memory artifact, summary, state, and plan. Reconciliation must complete before the round advances to `phase: "next"`.

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

### Reconcile Result Contract

```json
{
  "status": "reconcile_complete",
  "operation": "reconcile",
  "applied": [
    {
      "action": "archive | update | delete",
      "candidateId": "CAND_001",
      "memoryId": "MEM_YYYYMMDD_NNN"
    }
  ],
  "pendingCandidates": 0,
  "index": {
    "ok": true,
    "memoryCount": 0,
    "duplicateIds": [],
    "duplicateFiles": [],
    "missingFiles": []
  }
}
```

### Error Contract

```json
{
  "status": "error",
  "operation": "search | reconcile",
  "error": "<description of what went wrong>",
  "partial_result": null
}
```

## Anti-Patterns

- **Shallow summaries**: Extracting only a title without capturing decisions and lessons.
- **Tag spam**: Using too many or too generic tags (e.g., "code", "work").
- **Duplicate memories**: Creating a new memory when an existing one covers the same ground.
- **Skipping stale-memory cleanup**: Leaving obsolete memories in place when a newer memory fully supersedes them.
- **Index drift**: Forgetting to update `index.json` after creating a memory file.
- **Scope violation**: Touching files outside `.orbit/memories/`.
