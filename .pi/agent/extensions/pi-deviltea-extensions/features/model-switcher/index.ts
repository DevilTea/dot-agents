import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type TUI } from "@earendil-works/pi-tui";
import { getModalBodySize, isCancelKey, isTabBackward, isTabForward, renderModal, renderSectionBox, type ModalFrame } from "../../shared/modal.js";
import { FULLSCREEN_OVERLAY_OPTIONS } from "../../shared/overlay.js";
import { ensureViewportIndex } from "../../shared/viewport.js";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type FocusPane = "models" | "thinking";

type RuntimeModel = {
	provider: string;
	id: string;
	name?: string;
	reasoning?: boolean;
	thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
};

type SelectorResult = {
	model: RuntimeModel;
	thinkingLevel: ThinkingLevel;
};

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const THINKING_DESCRIPTIONS: Record<ThinkingLevel, string> = {
	off: "No reasoning",
	minimal: "Very brief reasoning",
	low: "Light reasoning",
	medium: "Moderate reasoning",
	high: "Deep reasoning",
	xhigh: "Maximum reasoning",
};

const originalSetDefaultModelAndProvider = SettingsManager.prototype.setDefaultModelAndProvider;
const originalSetDefaultThinkingLevel = SettingsManager.prototype.setDefaultThinkingLevel;
let allowDefaultWrites = false;
let settingsGuardInstalled = false;

function installSettingsGuard() {
	if (settingsGuardInstalled) return;
	settingsGuardInstalled = true;

	SettingsManager.prototype.setDefaultModelAndProvider = function guardedSetDefaultModelAndProvider(provider, modelId) {
		if (allowDefaultWrites) return originalSetDefaultModelAndProvider.call(this, provider, modelId);
	};

	SettingsManager.prototype.setDefaultThinkingLevel = function guardedSetDefaultThinkingLevel(level) {
		if (allowDefaultWrites) return originalSetDefaultThinkingLevel.call(this, level);
	};
}

async function withDefaultWrites<T>(fn: () => Promise<T>): Promise<T> {
	allowDefaultWrites = true;
	try {
		return await fn();
	} finally {
		allowDefaultWrites = false;
	}
}

function modelName(model: { id: string; name?: string }): string {
	return model.name || model.id;
}

function modelKey(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

function sameModel(a: { provider: string; id: string } | undefined, b: { provider: string; id: string } | undefined): boolean {
	return !!a && !!b && a.provider === b.provider && a.id === b.id;
}

function supportedThinkingLevels(model: RuntimeModel): ThinkingLevel[] {
	if (!model.reasoning) return ["off"];
	return THINKING_LEVELS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		if (level === "xhigh") return mapped !== undefined;
		return true;
	});
}

function clampThinkingLevel(model: RuntimeModel, level: ThinkingLevel): ThinkingLevel {
	const available = supportedThinkingLevels(model);
	if (available.includes(level)) return level;
	return available[0] ?? "off";
}

class ModelThinkingSelectorView implements Component {
	private focusPane: FocusPane = "models";
	private focusedModelIndex: number;
	private selectedModelIndex: number;
	private focusedThinkingLevel: ThinkingLevel;
	private selectedThinkingLevel: ThinkingLevel;
	private modelScroll = 0;
	private thinkingScroll = 0;
	private modelVisibleRows = 1;
	private thinkingVisibleRows = 1;
	private lastFrame?: ModalFrame;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly models: RuntimeModel[],
		initialModel: RuntimeModel,
		initialThinkingLevel: ThinkingLevel,
		private readonly done: (result: SelectorResult | null) => void,
	) {
		const initialIndex = Math.max(0, models.findIndex((model) => sameModel(model, initialModel)));
		this.focusedModelIndex = initialIndex;
		this.selectedModelIndex = initialIndex;
		this.selectedThinkingLevel = clampThinkingLevel(this.selectedModel(), initialThinkingLevel);
		this.focusedThinkingLevel = this.selectedThinkingLevel;
	}

	render(width: number): string[] {
		const rows = this.tui.terminal.rows;
		const bodySize = getModalBodySize("compact", width, rows, true);
		const boxWidth = bodySize.width;
		const boxHeight = bodySize.height;
		const contentWidth = Math.max(1, boxWidth - 4);
		const contentRows = Math.max(1, boxHeight - 2);
		const body = this.focusPane === "models" ? this.renderModels(contentWidth, contentRows) : this.renderThinking(contentWidth, contentRows);
		this.lastFrame = renderModal({
			theme: this.theme,
			terminalRows: rows,
			width,
			size: "compact",
			title: "Runtime Model",
			meta: `${modelKey(this.selectedModel())} • ${this.selectedThinkingLevel}`,
			tabs: [
				{ id: "models", label: "Model", complete: true },
				{ id: "thinking", label: "Thinking level", complete: true },
			],
			activeTabId: this.focusPane,
			body: renderSectionBox(this.theme, false, this.focusPane === "models" ? "Models" : "Thinking levels", boxWidth, body, boxHeight),
			hints: [
				{ key: "↑↓", label: "move" },
				{ key: "Tab", label: "pane" },
				{ key: "Space", label: "select" },
				{ key: "Enter", label: "apply" },
				{ key: "Esc", label: "cancel" },
			],
		});
		return this.lastFrame.lines;
	}

	invalidate(): void {}

	dispose(): void {}

	handleInput(data: string): void {
		if (isCancelKey(data)) {
			this.done(null);
			return;
		}
		if (isTabForward(data) || isTabBackward(data)) {
			this.focusPane = this.focusPane === "models" ? "thinking" : "models";
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.done({ model: this.selectedModel(), thinkingLevel: clampThinkingLevel(this.selectedModel(), this.selectedThinkingLevel) });
			return;
		}
		if (matchesKey(data, Key.space)) {
			if (this.focusPane === "models") this.selectFocusedModel();
			else this.selectFocusedThinking();
			return;
		}
		if (matchesKey(data, Key.up)) this.moveFocused(-1);
		else if (matchesKey(data, Key.down)) this.moveFocused(1);
	}

	private focusedModel(): RuntimeModel {
		return this.models[this.focusedModelIndex]!;
	}

	private selectedModel(): RuntimeModel {
		return this.models[this.selectedModelIndex]!;
	}

	private thinkingSourceModel(): RuntimeModel {
		return this.focusPane === "models" ? this.focusedModel() : this.selectedModel();
	}

	private thinkingLevels(): ThinkingLevel[] {
		return supportedThinkingLevels(this.thinkingSourceModel());
	}

	private moveFocused(delta: number): void {
		if (this.focusPane === "models") {
			this.focusedModelIndex = Math.max(0, Math.min(this.models.length - 1, this.focusedModelIndex + delta));
		} else {
			const levels = this.thinkingLevels();
			const current = Math.max(0, levels.indexOf(this.focusedThinkingLevel));
			this.focusedThinkingLevel = levels[Math.max(0, Math.min(levels.length - 1, current + delta))] ?? "off";
		}
		this.ensureVisible(this.focusPane);
		this.tui.requestRender();
	}

	private selectFocusedModel(): void {
		this.selectedModelIndex = this.focusedModelIndex;
		this.selectedThinkingLevel = clampThinkingLevel(this.selectedModel(), this.selectedThinkingLevel);
		this.focusedThinkingLevel = this.selectedThinkingLevel;
		this.tui.requestRender();
	}

	private selectFocusedThinking(): void {
		this.selectedThinkingLevel = clampThinkingLevel(this.selectedModel(), this.focusedThinkingLevel);
		this.focusedThinkingLevel = this.selectedThinkingLevel;
		this.tui.requestRender();
	}

	private ensureVisible(tab: FocusPane, visibleRows?: number): void {
		const visible = Math.max(1, visibleRows ?? (tab === "models" ? this.modelVisibleRows : this.thinkingVisibleRows));
		if (tab === "models") {
			this.modelScroll = ensureViewportIndex(this.modelScroll, this.focusedModelIndex, visible);
		} else {
			const index = this.thinkingLevels().indexOf(this.focusedThinkingLevel);
			this.thinkingScroll = ensureViewportIndex(this.thinkingScroll, index, visible);
		}
	}

	private renderModels(width: number, visible: number): string[] {
		const listRows = Math.max(1, visible - 4);
		this.modelVisibleRows = listRows;
		this.ensureVisible("models", listRows);
		const lines = [this.theme.fg("dim", "Select runtime model. Space selects focused row; Enter applies selected model and thinking level."), ""];
		for (let i = this.modelScroll; i < Math.min(this.models.length, this.modelScroll + listRows); i++) {
			const model = this.models[i]!;
			const focused = i === this.focusedModelIndex;
			const selected = i === this.selectedModelIndex;
			const focus = focused ? this.theme.fg("accent", ">") : " ";
			const radio = this.theme.fg(selected ? "success" : "muted", selected ? "●" : "○");
			const text = `${focus} ${radio} (${model.provider}) ${modelName(model)}`;
			lines.push(focused ? this.theme.fg("accent", text) : text);
		}
		lines.push("", this.theme.fg("muted", `Focused model ID: ${this.focusedModel().id}`));
		return lines;
	}

	private renderThinking(_width: number, visible: number): string[] {
		const levels = this.thinkingLevels();
		const listRows = Math.max(1, visible - 2);
		this.thinkingVisibleRows = listRows;
		this.ensureVisible("thinking", listRows);
		const lines = [this.theme.fg("dim", `Thinking levels for ${modelKey(this.thinkingSourceModel())}.`), ""];
		for (let i = this.thinkingScroll; i < Math.min(levels.length, this.thinkingScroll + listRows); i++) {
			const level = levels[i]!;
			const focused = level === this.focusedThinkingLevel;
			const selected = sameModel(this.thinkingSourceModel(), this.selectedModel()) && level === this.selectedThinkingLevel;
			const focus = focused ? this.theme.fg("accent", ">") : " ";
			const radio = this.theme.fg(selected ? "success" : "muted", selected ? "●" : "○");
			const text = `${focus} ${radio} ${level} ${this.theme.fg("muted", THINKING_DESCRIPTIONS[level])}`;
			lines.push(focused ? this.theme.fg("accent", text) : text);
		}
		return lines;
	}
}

class ConfirmDefaultsView implements Component {
	private armed = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly model: RuntimeModel,
		private readonly thinkingLevel: string,
		private readonly done: (approved: boolean) => void,
	) {}

	render(width: number): string[] {
		return renderModal({
			theme: this.theme,
			terminalRows: this.tui.terminal.rows,
			width,
			size: "compact",
			title: "Save Model Defaults",
			meta: "risky setting write",
			body: [
				this.theme.fg("warning", this.armed ? "Press Enter again to save defaults." : "This will update default model settings."),
				"",
				`Provider: ${this.model.provider}`,
				`Model: ${modelName(this.model)} (${this.model.id})`,
				`Thinking: ${this.thinkingLevel}`,
			],
			hints: this.armed
				? [
					{ key: "Enter", label: "confirm" },
					{ key: "Esc", label: "cancel" },
				]
				: [
					{ key: "Enter", label: "arm" },
					{ key: "Esc", label: "cancel" },
				],
		}).lines;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		if (isCancelKey(data)) {
			this.done(false);
			return;
		}
		if (!matchesKey(data, Key.enter)) return;
		if (this.armed) this.done(true);
		else {
			this.armed = true;
			this.tui.requestRender();
		}
	}
}

async function openRuntimeSelector(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("pi-model-switcher requires interactive UI", "warning");
		return;
	}

	ctx.modelRegistry.refresh();
	const models = (await ctx.modelRegistry.getAvailable()) as RuntimeModel[];
	if (models.length === 0) {
		ctx.ui.notify("No available models", "warning");
		return;
	}

	const currentModel = models.find((model) => sameModel(model, ctx.model)) ?? models[0]!;
	const currentThinkingLevel = clampThinkingLevel(currentModel, pi.getThinkingLevel() as ThinkingLevel);

	const result = await ctx.ui.custom<SelectorResult | null>(
		(tui: TUI, theme: Theme, _keybindings: unknown, done: (value: SelectorResult | null) => void) =>
			new ModelThinkingSelectorView(tui, theme, models, currentModel, currentThinkingLevel, done),
		FULLSCREEN_OVERLAY_OPTIONS,
	);
	if (!result) return;

	const success = await pi.setModel(result.model as any);
	if (!success) {
		ctx.ui.notify(`No API key for ${modelKey(result.model)}`, "error");
		return;
	}
	pi.setThinkingLevel(result.thinkingLevel);
	ctx.ui.notify(`Runtime model: ${modelKey(result.model)} • thinking:${result.thinkingLevel}`, "info");
}

export default function piModelSwitcher(pi: ExtensionAPI) {
	installSettingsGuard();

	pi.registerCommand("save-model-defaults", {
		description: "Save current model and thinking level as defaults",
		handler: async (_args, ctx) => {
			const model = ctx.model as RuntimeModel | undefined;
			if (!model) {
				ctx.ui.notify("No active model", "warning");
				return;
			}
			if (!ctx.hasUI) {
				ctx.ui.notify("save-model-defaults requires interactive UI", "warning");
				return;
			}

			const thinkingLevel = pi.getThinkingLevel();
			const approved = await ctx.ui.custom<boolean>(
				(tui: TUI, theme: Theme, _keybindings: unknown, done: (approved: boolean) => void) => new ConfirmDefaultsView(tui, theme, model, thinkingLevel, done),
				FULLSCREEN_OVERLAY_OPTIONS,
			);
			if (!approved) return;

			await withDefaultWrites(async () => {
				const settings = SettingsManager.create(ctx.cwd);
				settings.setDefaultModelAndProvider(model.provider, model.id);
				settings.setDefaultThinkingLevel(thinkingLevel);
			});

			ctx.ui.notify(`Saved default model: ${model.provider}/${modelName(model)} • thinking:${thinkingLevel}`, "info");
		},
	});

	pi.registerShortcut("ctrl+shift+l", {
		description: "Open runtime model/thinking selector",
		handler: async (ctx) => {
			await openRuntimeSelector(pi, ctx);
		},
	});
}
