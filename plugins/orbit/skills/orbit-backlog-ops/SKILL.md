---
name: orbit-backlog-ops
description: "Backlog file format, operations, and CLI documentation for the Orbit backlog system. Defines validation rules, CLI commands, agent interaction patterns, and anti-patterns."
---

# Backlog Operations

This skill defines the authoritative rules for the Orbit backlog system. Every Orbit agent that reads, writes, or presents backlog items MUST read and follow these rules.

## File Format

Backlog items live in `.orbit/backlog/` as individual Markdown files with YAML frontmatter.

### File Naming

- Pattern: `<slug>.md`
- Slug regex: `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`
- Examples: `improve-error-handling.md`, `add-auth-middleware.md`

### Frontmatter Schema

```yaml
---
slug: "improve-error-handling"
value: 8 # Integer 1-10 (10 = highest priority)
createdAt: "2026-04-20T13:30:00.000Z" # ISO 8601
summary: "Improve error handling across API endpoints."
---
```

| Field       | Type    | Required | Constraints           |
| ----------- | ------- | -------- | --------------------- |
| `slug`      | string  | yes      | Must match slug regex |
| `value`     | integer | yes      | 1-10 inclusive        |
| `createdAt` | string  | yes      | ISO 8601 timestamp    |
| `summary`   | string  | yes      | Brief description     |

### Body

Free-form Markdown content below the frontmatter. Used for initial thoughts, rough ideas, and context that informs future planning.

## CLI Commands

All commands are invoked via `node .orbit/scripts/cli.mjs <command>`.

### `backlog-list`

List all backlog items, sorted by value (descending) or creation date (descending).

```bash
node .orbit/scripts/cli.mjs backlog-list
node .orbit/scripts/cli.mjs backlog-list --sort value   # default
node .orbit/scripts/cli.mjs backlog-list --sort date
```

**Output:** `{ ok: true, items: [{ slug, value, createdAt, summary }] }`

### `backlog-add`

Add a new backlog item.

```bash
node .orbit/scripts/cli.mjs backlog-add \
  --slug "improve-error-handling" \
  --value 8 \
  --summary "Improve error handling across API endpoints." \
  --body "Initial thoughts: wrap all handlers in try-catch."

# Or with a body file:
node .orbit/scripts/cli.mjs backlog-add \
  --slug "improve-error-handling" \
  --value 8 \
  --summary "Improve error handling." \
  --body-file path/to/notes.md
```

**Output:** `{ ok: true, slug: "...", filePath: "..." }`

### `backlog-get`

Retrieve a single backlog item by slug.

```bash
node .orbit/scripts/cli.mjs backlog-get improve-error-handling
```

**Output:** `{ ok: true, item: { slug, value, createdAt, summary, body } }`

### `backlog-remove`

Remove a backlog item by slug.

```bash
node .orbit/scripts/cli.mjs backlog-remove improve-error-handling
```

**Output:** `{ ok: true, removed: true|false, slug: "..." }`

## Agent Interaction Patterns

### Orbit Backlog Agent Flow

The `Orbit Backlog` agent is dispatched by the Orbit Dispatcher to present backlog items to the user for selection.

1. **Read backlog** via `backlog-list` CLI command.
2. **Ask sorting preference** via `vscode_askQuestions`: value (high→low) or date (new→old).
3. **Present items** as a multi-select list via `vscode_askQuestions`.
4. **Return selected items** to the Dispatcher in the return contract.

### Return Contract

```json
{
  "status": "completed | empty | cancelled",
  "selected": [{ "slug": "...", "value": 8, "summary": "..." }]
}
```

- `completed`: User selected one or more items.
- `empty`: Backlog has no items.
- `cancelled`: User dismissed the selection.

## Anti-Patterns

- **Missing value score.** Every backlog item MUST have a value score 1-10. Items without scores cannot be prioritized.
- **Duplicate slugs.** Slug must be unique within the backlog directory. The file system enforces this — `addBacklogItem` will overwrite if the slug already exists.
- **Non-slug filenames.** Only files matching the slug regex are valid. Do not manually create files with spaces, uppercase, or special characters.
- **Editing via raw file writes.** Always use the CLI or library functions to ensure frontmatter consistency.
- **Treating backlog as a task queue.** Backlog items are candidates for future rounds, not committed work. Selection happens through the Orbit Backlog agent, not automatic processing.
