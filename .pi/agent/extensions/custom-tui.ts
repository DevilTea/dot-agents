/**
 * Custom TUI Extension - Immersive Mode
 *
 * Layout:
 * - Header: hidden (invisible component)
 * - Footer: custom info bar with cwd, branch, usage, model
 */

import path from "node:path";

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const CLEAR_SEQUENCE = "\x1b[2J\x1b[H\x1b[3J";

/** Track last branch-change unsubscribe for cleanup on session shutdown */
let lastBranchChangeUnsubscribe: (() => void) | undefined;

function createFooterComponent(extCtx) {
  return function CustomFooter(tui, theme, footerData) {
    lastBranchChangeUnsubscribe?.();
    const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
    lastBranchChangeUnsubscribe = unsubscribe;
    return {
      render(width: number): string[] {
        if (!theme || !extCtx) return [""];

        // Context usage
        const ctxUsage = extCtx.getContextUsage?.();
        let usageStr = "";
        if (ctxUsage && ctxUsage.contextWindow > 0) {
          const tokensStr =
            ctxUsage.tokens !== null
              ? ctxUsage.tokens.toLocaleString()
              : "N/A";
          const pctStr =
            ctxUsage.tokens !== null
              ? ` (${((ctxUsage.tokens / ctxUsage.contextWindow) * 100).toFixed(1)}%)`
              : "";
          usageStr = `${tokensStr}/${ctxUsage.contextWindow.toLocaleString()}${pctStr}`;
        }

        // Working directory - last path component (cross-platform)
        const cwd = path.basename(extCtx.cwd) || ".";

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
    };
  };
}

export default function (pi: ExtensionAPI) {
  let footerApplied = false;
  let applyFooter: (() => void) | undefined;

  pi.on("session_start", async (event, c) => {
    if (c.hasUI) {
      // Only clear screen on fresh session; reload/fork/resume keep existing view
      if (event.reason === "startup" || event.reason === "new") {
        process.stdout.write(CLEAR_SEQUENCE);
      }
      const footerComponent = createFooterComponent(c);
      footerApplied = false;
      applyFooter = () => {
        if (!footerComponent || footerApplied) return;
        footerApplied = true;
        c.ui.setFooter(footerComponent);
      };
      applyFooter();
    }
  });

  pi.on("model_select", () => {
    applyFooter?.();
  });

  pi.on("session_shutdown", async (_event, _c) => {
    footerApplied = false;
    applyFooter = undefined;
    lastBranchChangeUnsubscribe?.();
    lastBranchChangeUnsubscribe = undefined;
  });
}
