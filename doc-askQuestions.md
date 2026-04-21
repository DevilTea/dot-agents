# `vscode_askQuestions` Supported Question Formats

This document describes every supported input shape for the `vscode_askQuestions` tool, based on its current schema.

## Purpose

Use `vscode_askQuestions` to present a small set of clarifying questions to the user before continuing a task.

The tool accepts a single object with one required property:

```json
{
  "questions": [
    {
      "header": "example",
      "question": "What do you want to do?"
    }
  ]
}
```

## Top-Level Input Schema

### `questions`

- Type: `Array<Question>`
- Required: yes
- Minimum items: `1`
- Order: preserved exactly as provided

This means:

- You must provide at least one question.
- Questions are shown in the same order you send them.
- Each question can use a different format.

## `Question` Object Schema

Each item in `questions` must be an object with the following fields.

### Required fields

#### `header`

- Type: `string`
- Required: yes
- Maximum length: `50`
- Must be unique within the request

Purpose:

- Acts as the stable identifier for the question.
- Lets the caller map returned answers back to the correct question.

Guidance:

- Keep it short and machine-friendly.
- Use a unique value for each question.

Example:

```json
"header": "runtime"
```

#### `question`

- Type: `string`
- Required: yes
- Maximum length: `200`

Purpose:

- The main prompt shown to the user.

Guidance:

- Prefer one concise sentence.
- Write the direct thing you need to know.

Example:

```json
"question": "Which runtime should this project target?"
```

### Optional fields

#### `multiSelect`

- Type: `boolean`
- Required: no
- Default behavior: single selection when options are present

Purpose:

- Controls whether the user can choose more than one option.

Behavior:

- `true`: multiple options may be selected.
- `false` or omitted: only one option may be selected.

#### `allowFreeformInput`

- Type: `boolean`
- Required: no
- Default: `true`

Purpose:

- Controls whether the user may type a custom answer in addition to using options.

Behavior:

- `true`: user may provide freeform text.
- `false`: user must use the predefined options only.

Important note:

- If you omit this field, freeform input is still allowed.

#### `message`

- Type: `string`
- Required: no
- Format: Markdown supported

Purpose:

- Adds supplementary context below the main question.
- Useful for constraints, examples, caveats, or brief instructions.

Example:

```json
"message": "Use this when the choice affects deployment or compatibility."
```

#### `options`

- Type: `Array<Option>`
- Required: no

Purpose:

- Provides selectable answers.

Behavior:

- If omitted, the question becomes a free-text question.
- If present, the question becomes an option-based question.

## `Option` Object Schema

Each item in `options` must be an object with the following fields.

### `label`

- Type: `string`
- Required: yes

Purpose:

- The main display text for the option.

Example:

```json
"label": "Node.js 22"
```

### `description`

- Type: `string`
- Required: no

Purpose:

- Secondary explanatory text shown under the label.
- Helps the user understand when to choose that option.

Example:

```json
"description": "Recommended for the current deployment environment."
```

### `recommended`

- Type: `boolean`
- Required: no

Purpose:

- Marks the option as the recommended default.

Behavior:

- Use this when one answer is the preferred default choice.
- The schema does not state exclusivity, but the practical intent is usually to recommend one option.

## Supported Question Formats

The tool supports the following effective question formats.

### 1. Free-Text Question

Use this when the user should type an answer rather than choose from a list.

Required fields:

- `header`
- `question`

Typical shape:

```json
{
  "questions": [
    {
      "header": "feature_name",
      "question": "What should the new feature be called?"
    }
  ]
}
```

Notes:

- `options` is omitted.
- `allowFreeformInput` is unnecessary here because the question is already free-text by shape.
- `message` may still be added.

### 2. Single-Select Question With Optional Freeform Input

Use this when you want to suggest choices but still allow the user to type something else.

Required fields:

- `header`
- `question`
- `options`

Typical shape:

```json
{
  "questions": [
    {
      "header": "runtime",
      "question": "Which runtime should we use?",
      "options": [
        {
          "label": "Node.js 20"
        },
        {
          "label": "Node.js 22",
          "recommended": true
        }
      ]
    }
  ]
}
```

Equivalent explicit form:

```json
{
  "questions": [
    {
      "header": "runtime",
      "question": "Which runtime should we use?",
      "multiSelect": false,
      "allowFreeformInput": true,
      "options": [
        {
          "label": "Node.js 20"
        },
        {
          "label": "Node.js 22",
          "recommended": true
        }
      ]
    }
  ]
}
```

Notes:

- This is the default option-based format.
- `multiSelect` can be omitted because single-select is the default behavior.
- `allowFreeformInput` can be omitted because it defaults to `true`.

### 3. Single-Select Question With Fixed Choices Only

Use this when the answer must come from the provided options.

Required fields:

- `header`
- `question`
- `options`

Important field:

- `allowFreeformInput: false`

Typical shape:

```json
{
  "questions": [
    {
      "header": "package_manager",
      "question": "Which package manager should be used?",
      "allowFreeformInput": false,
      "options": [
        {
          "label": "npm"
        },
        {
          "label": "pnpm",
          "recommended": true
        },
        {
          "label": "yarn"
        }
      ]
    }
  ]
}
```

Notes:

- User must pick exactly one listed option.
- This is useful for controlled workflows where arbitrary answers would break later logic.

### 4. Multi-Select Question With Optional Freeform Input

Use this when the user may choose several options and may also type extra answers.

Required fields:

- `header`
- `question`
- `options`

Important field:

- `multiSelect: true`

Typical shape:

```json
{
  "questions": [
    {
      "header": "targets",
      "question": "Which platforms should be supported?",
      "multiSelect": true,
      "options": [
        {
          "label": "macOS"
        },
        {
          "label": "Linux",
          "recommended": true
        },
        {
          "label": "Windows"
        }
      ]
    }
  ]
}
```

Equivalent explicit form:

```json
{
  "questions": [
    {
      "header": "targets",
      "question": "Which platforms should be supported?",
      "multiSelect": true,
      "allowFreeformInput": true,
      "options": [
        {
          "label": "macOS"
        },
        {
          "label": "Linux",
          "recommended": true
        },
        {
          "label": "Windows"
        }
      ]
    }
  ]
}
```

Notes:

- The user may choose multiple listed values.
- Because `allowFreeformInput` defaults to `true`, custom text remains allowed unless you explicitly disable it.

### 5. Multi-Select Question With Fixed Choices Only

Use this when the user may choose several options, but all answers must come from the provided list.

Required fields:

- `header`
- `question`
- `options`

Important fields:

- `multiSelect: true`
- `allowFreeformInput: false`

Typical shape:

```json
{
  "questions": [
    {
      "header": "checks",
      "question": "Which checks should run in CI?",
      "multiSelect": true,
      "allowFreeformInput": false,
      "options": [
        {
          "label": "Unit tests",
          "recommended": true
        },
        {
          "label": "Lint"
        },
        {
          "label": "Typecheck"
        },
        {
          "label": "E2E tests"
        }
      ]
    }
  ]
}
```

Notes:

- User may select more than one option.
- User may not type custom values.

### 6. Any Question Format With Supplemental Markdown Message

The `message` field is not a separate question type, but it is supported on every question format.

Example:

```json
{
  "questions": [
    {
      "header": "deployment",
      "question": "Where should this be deployed first?",
      "allowFreeformInput": false,
      "message": "Choose the environment that matches the release plan.\n\n- Staging is safer for validation\n- Production is for immediate rollout",
      "options": [
        {
          "label": "Staging",
          "recommended": true
        },
        {
          "label": "Production"
        }
      ]
    }
  ]
}
```

Notes:

- The message appears below the question.
- Markdown can be used for extra detail.
- This is useful when the short `question` field is not enough to explain context.

## Mixed Questionnaire Format

You can combine different question styles in a single call.

Example:

```json
{
  "questions": [
    {
      "header": "project_name",
      "question": "What should the project be called?"
    },
    {
      "header": "template",
      "question": "Which starter should be used?",
      "allowFreeformInput": false,
      "options": [
        {
          "label": "Library"
        },
        {
          "label": "CLI",
          "recommended": true
        },
        {
          "label": "Web app"
        }
      ]
    },
    {
      "header": "targets",
      "question": "Which deployment targets matter?",
      "multiSelect": true,
      "options": [
        {
          "label": "Desktop"
        },
        {
          "label": "Server"
        },
        {
          "label": "Edge"
        }
      ]
    }
  ]
}
```

## Behavioral Rules and Constraints

### Answer mapping

- `header` must be unique so answers can be associated with the correct question.

### Ordering

- Questions are shown in the same order as the array.

### Freeform defaults

- If `options` exist and `allowFreeformInput` is omitted, the user can still type a custom answer.

### Single-select default

- If `options` exist and `multiSelect` is omitted, the tool behaves as single-select.

### Fixed-choice enforcement

- To force the user to choose only from the listed options, set `allowFreeformInput` to `false`.

### Option descriptions

- `description` adds supporting text but does not change selection logic.

### Recommended option

- `recommended` marks a preferred answer but does not remove other choices.

## Quick Reference Matrix

| Format                  | `options` | `multiSelect`      | `allowFreeformInput` | Result                                               |
| ----------------------- | --------- | ------------------ | -------------------- | ---------------------------------------------------- |
| Free-text               | omitted   | omitted            | omitted              | User types any answer                                |
| Single-select, flexible | present   | omitted or `false` | omitted or `true`    | User picks one option or types another answer        |
| Single-select, fixed    | present   | omitted or `false` | `false`              | User picks exactly one listed option                 |
| Multi-select, flexible  | present   | `true`             | omitted or `true`    | User picks multiple options and may type extra input |
| Multi-select, fixed     | present   | `true`             | `false`              | User picks multiple listed options only              |

## Best-Practice Recommendations

- Keep `header` short, unique, and stable.
- Keep `question` concise and direct.
- Use `message` only when extra context is actually needed.
- Use `allowFreeformInput: false` when downstream logic depends on known values.
- Use `recommended: true` when one option is the preferred default.
- Avoid asking too many questions in one request.

## Minimal Templates

### Minimal free-text template

```json
{
  "questions": [
    {
      "header": "name",
      "question": "What name should be used?"
    }
  ]
}
```

### Minimal single-select fixed template

```json
{
  "questions": [
    {
      "header": "choice",
      "question": "Choose one option.",
      "allowFreeformInput": false,
      "options": [
        {
          "label": "A"
        },
        {
          "label": "B"
        }
      ]
    }
  ]
}
```

### Minimal multi-select fixed template

```json
{
  "questions": [
    {
      "header": "features",
      "question": "Choose one or more features.",
      "multiSelect": true,
      "allowFreeformInput": false,
      "options": [
        {
          "label": "Search"
        },
        {
          "label": "Auth"
        }
      ]
    }
  ]
}
```
