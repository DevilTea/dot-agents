/**
 * Custom TUI Extension - Immersive Mode
 *
 * Layout:
 * - Header: hidden (invisible component)
 * - Footer: custom info bar with cwd, branch, usage, model
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const CLEAR_SEQUENCE = "\x1b[2J\x1b[H\x1b[3J";

/** Empty header component - renders nothing to hide the header */
function InvisibleHeader() {
  return {
    render(_width: number): string[] {
      return [];
    },
    invalidate() {},
  };
}

function createFooterComponent(extCtx) {
  return function CustomFooter(tui, theme, footerData) {
    return {
      render(width: number): string[] {
        if (!theme || !extCtx) return [""];

        // Context usage
        const ctxUsage = extCtx.getContextUsage?.();
        let usageStr = "";
        if (
          ctxUsage &&
          ctxUsage.tokens !== null &&
          ctxUsage.contextWindow > 0
        ) {
          const pct = (
            (ctxUsage.tokens / ctxUsage.contextWindow) *
            100
          ).toFixed(1);
          usageStr = `${ctxUsage.tokens.toLocaleString()}/${ctxUsage.contextWindow.toLocaleString()} (${pct}%)`;
        }

        // Working directory - last path component
        const cwd = extCtx.cwd.split("/").filter(Boolean).pop() || ".";

        const branch = footerData.getGitBranch();
        const modelName = extCtx.model?.name ?? extCtx.model?.id ?? "?";

        // Left part: dirname + (branch)
        let leftPart = theme.fg("muted", cwd);
        if (branch) {
          leftPart += ` (${theme.fg("accent", branch)})`;
        }

        // Right part: usage + model name
        const pctNum = ctxUsage?.percent;
        const usageColor =
          typeof pctNum === "number"
            ? pctNum > 90
              ? "error"
              : pctNum > 70
                ? "warning"
                : "success"
            : "muted";

        const rightParts: string[] = [];
        if (usageStr) {
          rightParts.push(theme.fg(usageColor, usageStr));
        }
        rightParts.push(theme.bold(theme.fg("text", modelName)));
        const rightPart = rightParts.join(" ");

        // Calculate padding to fill remaining space
        const leftW = visibleWidth(leftPart);
        const rightW = visibleWidth(rightPart);
        const pad = Math.max(2, width - leftW - rightW);

        return [truncateToWidth(leftPart + " ".repeat(pad) + rightPart, width)];
      },
      invalidate() {},
      dispose: footerData.onBranchChange(() => tui.requestRender()),
    };
  };
}

export default function (pi: ExtensionAPI) {
  let applyFooter;

  pi.on("session_start", async (_event, c) => {
    if (c.hasUI) {
      process.stdout.write(CLEAR_SEQUENCE);
      c.ui.setHeader(InvisibleHeader);
      const footerComponent = createFooterComponent(c);
      applyFooter = () => {
        if (!footerComponent) return;
        c.ui.setFooter(footerComponent);
      };
      applyFooter();
    }
  });

  pi.on("model_select", () => {
    applyFooter?.();
  });
}
