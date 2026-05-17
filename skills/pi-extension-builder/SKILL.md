---
name: pi-extension-builder
description: >
  Build, debug, or extend pi extensions. Use when the user wants to create
  a pi extension, register a custom tool (registerTool), add an event hook
  (pi.on), create a slash command, build custom UI, or modify pi behavior
  via ExtensionAPI. Also triggers on pi extension lifecycle, session events,
  tool_call interception, custom commands, TUI widgets, or pi skill creation.
  Prefer over generic TypeScript knowledge when the task involves pi's
  extension system.
---

# pi-extension-builder

Build pi extensions that extend pi's behavior: custom tools, event hooks,
commands, UI components, and more.

## Discovery

Run the discovery script from the skill directory. It locates the pi
installation and exports paths for all subsequent file reads.

```bash
source <skill_dir>/scripts/discover-pi.sh
```

The script exports:
- `PI_DOCS` — path to `docs/`
- `PI_EXAMPLES` — path to `examples/extensions/`
- `PI_PKG` — path to `pi-coding-agent/` package root

If the script fails (exit 1), ask the user for the pi installation path.

## Workflow

### 1. Understand the goal

Ask the user what the extension should do. Map to a category:

| Goal | Category |
|------|----------|
| Add a tool the LLM can call | **Custom Tool** |
| Block/modify tool calls | **Event Hook** (tool_call) |
| Add a `/command` | **Command** |
| Show custom UI / dialogs | **Custom UI** |
| Modify system prompt | **Event Hook** (before_agent_start) |
| Manage session state | **Session Management** |
| Process user input | **Input Processing** |
| Render messages differently | **Custom Renderer** |
| Game / animation | **Advanced UI** |

### 2. Find the right example

List examples at runtime:

```bash
ls -1 "$PI_EXAMPLES" | sort
```

Pick 1-2 examples closest to the user's goal. Read them. The examples are
self-contained and serve as the primary reference — do not duplicate their
content in the SKILL.md.

Also read `"$PI_DOCS/extensions.md"` when the user needs API details not
covered by examples (e.g., full event list, context methods).

### 3. Scaffold the extension

Use the directory template from `templates/extension_template/`. Create a new
folder named after the extension:

```
<name>/
├── package.json
└── index.ts
```

Placement:
- **Global**: `~/.pi/agent/extensions/<name>/`
- **Project-local**: `.pi/extensions/<name>/`

Steps:
1. Copy `templates/extension_template/` to the target location
2. Replace `<extension_name>` in `package.json` with the extension name
3. Replace `<description>` in `package.json` with a brief description
4. Open `index.ts` and replace placeholder comments with the actual logic
5. Run `npm install` inside the extension folder (installs typebox + resolves peer deps)
6. Test with `pi --extension <path>` or `/reload` if placed in auto-discovered path

### 4. Verify

- `/reload` loads without errors
- Tool appears in `pi.getAllTools()`
- Command appears as `/name`
- Event handlers fire as expected

## Key patterns

### Custom tool

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "tool_name",
    label: "Tool Label",
    description: "What this tool does",
    parameters: Type.Object({ /* schema */ }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return { content: [{ type: "text", text: "Result" }], details: {} };
    },
  });
}
```

### Event hook

```typescript
export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    // event.toolName, event.toolCallId, event.input
    return { block: true, reason: "..." };  // block
    // or mutate event.input to patch args
  });
}
```

### Command

```typescript
export default function (pi: ExtensionAPI) {
  pi.registerCommand("mycmd", {
    description: "What this command does",
    handler: async (args, ctx) => {
      ctx.ui.notify("Result", "info");
    },
  });
}
```

### UI interaction

```typescript
ctx.ui.notify("Message", "info" | "success" | "warning" | "error");
const ok = await ctx.ui.confirm("Title", "Question?");
const choice = await ctx.ui.select("Title", ["opt1", "opt2"]);
const input = await ctx.ui.input("Title", { placeholder: "..." });
ctx.ui.setStatus("my-ext", "Status");
ctx.ui.setWidget("my-ext", ["Line 1", "Line 2"]);
```

## Common pitfalls

- `ctx.signal` is `undefined` outside active turns — don't use in session events
- `ctx.sessionManager` is stale after session replacement — use the replacement ctx
- `tool_call` handlers in parallel mode may not see sibling tool results
- Custom tools need TypeBox schemas (`Type.String()`, `Type.Object()`, etc.)
- `promptGuidelines` are appended flat — each must name the tool
- Extensions in auto-discovered locations hot-reload with `/reload`
- Async factory functions complete before `session_start` fires
