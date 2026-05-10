/**
 * Custom Info Footer Extension
 *
 * Layout: <dirname> (<branch>) [padding] <usage> <model_name>
 * Colorful theme-aware styling using built-in theme colors.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
	let extCtx: ExtensionContext | undefined;

	const applyFooter = () => {
		if (!extCtx) return;
		extCtx.ui.setFooter((tui, theme, footerData) => ({
			render(width: number): string[] {
				if (!theme || !extCtx) return [""];

				// Context usage
				const ctxUsage = extCtx.getContextUsage?.();
				let usageStr = "";
				if (ctxUsage && ctxUsage.tokens !== null && ctxUsage.contextWindow > 0) {
					const pct = ((ctxUsage.tokens / ctxUsage.contextWindow) * 100).toFixed(1);
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
				const usageColor = typeof pctNum === "number"
					? pctNum > 90 ? "error" : pctNum > 70 ? "warning" : "success"
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
		}));
	};

	pi.on("session_start", async (_event, c) => {
		extCtx = c;
		c.ui.notify("Custom info footer enabled", "info");
		applyFooter();
	});

	pi.on("model_select", () => {
		applyFooter();
	});
}
