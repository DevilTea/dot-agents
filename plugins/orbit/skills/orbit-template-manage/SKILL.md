---
name: orbit-template-manage
description: "Task template discovery, matching, creation, and management for Orbit. Defines how templates are structured, discovered, matched to user requests, and passed through the workflow."
---

# Template Management

This skill defines the authoritative rules for task template operations within the Orbit workflow. Every Orbit agent that handles templates MUST read and follow these rules.

## Template Location

All task templates live in `.orbit/templates/*.md`.

## Template Format

Each template is a Markdown file with YAML frontmatter:

```markdown
---
name: "<human-readable template name>"
keywords: [keyword1, keyword2, keyword3]
description: "<1-2 sentence description of when to use this template>"
---

# Template Content

<structured guidance for the task type>
```

### Frontmatter Fields

| Field         | Required | Description                                          |
| ------------- | -------- | ---------------------------------------------------- |
| `name`        | Yes      | Human-readable template name                         |
| `keywords`    | Yes      | Array of keywords for matching against user requests |
| `description` | Yes      | Brief description of when this template applies      |

## Template Discovery

### Listing Templates

Use the CLI to list all available templates:

```bash
node .orbit/scripts/cli.mjs templates
```

Returns a JSON object of the form `{ ok: true, templates: string[] }`, where `templates` is an array of template filenames (e.g. `["refactor-module.md"]`). Use `read-template <filename>` to fetch the frontmatter + body for any specific template.

### Keyword Matching

Use the CLI to find templates matching a user's request:

```bash
node .orbit/scripts/cli.mjs match-template "<user request text>"
```

The matching algorithm scores templates by word overlap between the user's request and the template's filename, frontmatter keywords, and body content. Results are ranked by relevance.

### Reading a Template

```bash
node .orbit/scripts/cli.mjs read-template <filename>
```

Returns the full template content including parsed frontmatter and body.

## Workflow Integration

### Dispatcher Phase (Orbit Dispatcher)

Before dispatching Round, the dispatcher MUST:

1. Scan `.orbit/templates/*.md` for keyword matches against the user's request using `match-template`.
2. If a template matches, read its content using `read-template`.
3. Pass the template content to `Orbit Round` as a `template_hint`.

### Clarify Phase (Orbit Round)

If the dispatcher provided a template hint:

1. Present it as the starting framework for the task.
2. Use the template's structured guidance to shape the clarification questions.
3. Allow the user to deviate from the template if their needs differ.

### Planning Phase (Orbit Planner)

If a template hint is provided in the input:

1. Use the template's structure as a starting point for the plan.
2. Ensure plan steps align with the template's guidance where applicable.
3. Deviate from the template only when the clarified requirements demand it.

## Creating New Templates

When the user wants to create a new task template:

1. **Gather requirements**: Determine the template's purpose, target task type, and typical workflow.
2. **Choose a descriptive filename**: Use kebab-case, e.g., `add-api-endpoint.md`, `refactor-module.md`.
3. **Write the template** following the format above:
   - Pick 3–6 keywords that users would naturally use when requesting this type of task.
   - Write a concise description of when the template applies.
   - Structure the body with clear sections that guide the Clarify and Planning phases.
4. **Save to `.orbit/templates/`**: Create the file at `.orbit/templates/<filename>.md`.
5. **Verify**: Run `node .orbit/scripts/cli.mjs templates` to confirm the template appears in the list.

### Template Body Best Practices

- **Use sections** to break the template into logical parts (e.g., "## Scope", "## Constraints", "## Deliverables").
- **Include checklist items** for common considerations the user should address during Clarify.
- **Provide examples** of typical inputs/outputs for the task type.
- **Keep it concise** — the template guides the conversation, not replaces it.
