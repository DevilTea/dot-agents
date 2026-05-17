import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // ── Custom Tool ────────────────────────────────────────────────────
  pi.registerTool({
    name: "<tool_name>",
    label: "<Tool Label>",
    description: "<What this tool does>",
    parameters: Type.Object({
      // Define tool parameters with TypeBox schemas
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // Stream progress updates (optional)
      // onUpdate?.({ content: [{ type: "text", text: "Working..." }] });

      return {
        content: [{ type: "text", text: "Result" }],
        details: {},
      };
    },
  });

  // ── Event Hook ─────────────────────────────────────────────────────
  // pi.on("event_name", handler) subscribes to extension events.
  // See $PI_DOCS/extensions.md for the full event list.
  //
  // Available events:
  //   session_start, session_before_switch, session_shutdown
  //   before_agent_start, agent_start, agent_end
  //   tool_call, tool_result, tool_execution_start/end
  //   input, user_bash
  //   context, before_provider_request, after_provider_response
  //   model_select, thinking_level_select
  //
  // Return { block: true, reason: "..." } to block tool execution.
  // Mutate event.input to patch tool arguments.

  pi.on("tool_call", async (event, ctx) => {
    // event.toolName, event.toolCallId, event.input
    // event is mutable — changes affect the actual tool execution
  });

  // ── Command ────────────────────────────────────────────────────────
  pi.registerCommand("<command_name>", {
    description: "<What this command does>",
    handler: async (args, ctx) => {
      // args — the argument string after /<command_name>
      // ctx — ExtensionCommandContext (has session control methods)
      ctx.ui.notify("Result", "info");
    },
  });

  // ── UI Interaction ─────────────────────────────────────────────────
  // ctx.ui methods available in event handlers and command handlers:
  //
  // ctx.ui.notify("Message", "info" | "success" | "warning" | "error")
  //   Fire-and-forget notification in the TUI
  //
  // await ctx.ui.confirm("Title", "Question?")
  //   Returns boolean — user approved or not
  //
  // await ctx.ui.select("Title", ["opt1", "opt2", "opt3"])
  //   Returns the selected value or null (cancelled)
  //
  // await ctx.ui.input("Title", { placeholder: "..." })
  //   Returns the entered string or null (cancelled)
  //
  // ctx.ui.setStatus("my-ext", "Status message")
  //   Sets the footer status bar
  //
  // ctx.ui.setWidget("my-ext", ["Line 1", "Line 2"])
  //   Shows a widget panel above the editor
}
