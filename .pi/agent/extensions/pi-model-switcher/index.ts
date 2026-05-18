import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, SelectList, Spacer, Text, type SelectItem } from "@earendil-works/pi-tui";

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

const STATUS_KEY = "pi-model-switcher";
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
		if (allowDefaultWrites) {
			return originalSetDefaultModelAndProvider.call(this, provider, modelId);
		}
	};

	SettingsManager.prototype.setDefaultThinkingLevel = function guardedSetDefaultThinkingLevel(level) {
		if (allowDefaultWrites) {
			return originalSetDefaultThinkingLevel.call(this, level);
		}
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

	const requestedIndex = THINKING_LEVELS.indexOf(level);
	if (requestedIndex === -1) return available[0] ?? "off";

	for (let i = requestedIndex; i < THINKING_LEVELS.length; i++) {
		const candidate = THINKING_LEVELS[i]!;
		if (available.includes(candidate)) return candidate;
	}
	for (let i = requestedIndex - 1; i >= 0; i--) {
		const candidate = THINKING_LEVELS[i]!;
		if (available.includes(candidate)) return candidate;
	}
	return available[0] ?? "off";
}

function listTheme(theme: any, active: boolean) {
	return {
		selectedPrefix: (text: string) => active ? theme.fg("accent", text) : theme.fg("muted", text),
		selectedText: (text: string) => active ? theme.fg("accent", text) : text,
		description: (text: string) => theme.fg("muted", text),
		scrollInfo: (text: string) => theme.fg("dim", text),
		noMatch: (text: string) => theme.fg("warning", text),
	};
}

class ModelThinkingSelectorView extends Container {
	private readonly tui: any;
	private readonly theme: any;
	private readonly done: (result: SelectorResult | null) => void;
	private readonly models: RuntimeModel[];
	private focusPane: FocusPane = "models";
	private focusedModelIndex: number;
	private selectedModelIndex: number;
	private focusedThinkingLevel: ThinkingLevel;
	private selectedThinkingLevel: ThinkingLevel;
	private modelList?: SelectList;
	private thinkingList?: SelectList;

	constructor(
		tui: any,
		theme: any,
		models: RuntimeModel[],
		initialModel: RuntimeModel,
		initialThinkingLevel: ThinkingLevel,
		done: (result: SelectorResult | null) => void,
	) {
		super();
		this.tui = tui;
		this.theme = theme;
		this.models = models;
		this.done = done;
		const initialIndex = Math.max(0, models.findIndex((model) => sameModel(model, initialModel)));
		this.focusedModelIndex = initialIndex;
		this.selectedModelIndex = initialIndex;
		this.selectedThinkingLevel = clampThinkingLevel(this.selectedModel(), initialThinkingLevel);
		this.focusedThinkingLevel = this.selectedThinkingLevel;
		this.rebuild();
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

	private selectedModelIndexByKey(key: string): number {
		const index = this.models.findIndex((model) => modelKey(model) === key);
		return index === -1 ? 0 : index;
	}

	private modelItems(): SelectItem[] {
		return this.models.map((model, index) => ({
			value: modelKey(model),
			label: `${index === this.selectedModelIndex ? "✓ " : "  "}(${model.provider}) ${modelName(model)}`,
		}));
	}

	private thinkingItems(): SelectItem[] {
		const previewModel = this.thinkingSourceModel();
		const selectedModel = this.selectedModel();
		return supportedThinkingLevels(previewModel).map((level) => ({
			value: level,
			label: `${sameModel(previewModel, selectedModel) && level === this.selectedThinkingLevel ? "✓ " : "  "}${level}`,
			description: THINKING_DESCRIPTIONS[level],
		}));
	}

	private currentThinkingPreviewIndex(levels: ThinkingLevel[]): number {
		const previewLevel = this.focusPane === "thinking"
			? clampThinkingLevel(this.selectedModel(), this.focusedThinkingLevel)
			: clampThinkingLevel(this.thinkingSourceModel(), this.selectedThinkingLevel);
		return Math.max(0, levels.indexOf(previewLevel));
	}

	private rebuild(): void {
		this.clear();

		const totalRows = Math.max(16, this.tui.terminal.rows);
		const modelVisible = Math.max(4, Math.min(10, Math.floor((totalRows - 10) * 0.6)));
		const thinkingVisible = Math.max(2, Math.min(6, totalRows - modelVisible - 10));
		const thinkingLevels = supportedThinkingLevels(this.thinkingSourceModel());

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(this.theme.fg("accent", this.theme.bold("Runtime model switcher")), 1, 0));
		this.addChild(new Text(this.theme.fg("dim", "This temporarily replaces prompt editor. Enter apply • Esc cancel"), 1, 0));
		this.addChild(new Spacer(1));

		const modelTitle = this.focusPane === "models"
			? this.theme.fg("accent", this.theme.bold("Models"))
			: this.theme.bold("Models");
		this.addChild(new Text(modelTitle, 1, 0));
		this.modelList = new SelectList(this.modelItems(), modelVisible, listTheme(this.theme, this.focusPane === "models"), {
			minPrimaryColumnWidth: 24,
			maxPrimaryColumnWidth: Math.max(24, this.tui.terminal.columns - 6),
		});
		this.modelList.setSelectedIndex(this.focusedModelIndex);
		this.modelList.onSelectionChange = (item) => {
			this.focusedModelIndex = this.selectedModelIndexByKey(item.value);
			if (this.focusPane === "models") {
				this.rebuild();
				this.tui.requestRender();
			}
		};
		this.addChild(this.modelList);
		this.addChild(new Text(this.theme.fg("muted", `Model ID: ${this.focusedModel().id}`), 1, 0));
		this.addChild(new Spacer(1));

		const thinkingTitleText = this.focusPane === "models"
			? "Thinking levels for focused model"
			: "Thinking levels for selected model";
		const thinkingTitle = this.focusPane === "thinking"
			? this.theme.fg("accent", this.theme.bold(thinkingTitleText))
			: this.theme.bold(thinkingTitleText);
		this.addChild(new Text(thinkingTitle, 1, 0));
		this.thinkingList = new SelectList(this.thinkingItems(), Math.min(thinkingVisible, thinkingLevels.length), listTheme(this.theme, this.focusPane === "thinking"), {
			minPrimaryColumnWidth: 12,
			maxPrimaryColumnWidth: 18,
		});
		this.thinkingList.setSelectedIndex(this.currentThinkingPreviewIndex(thinkingLevels));
		this.thinkingList.onSelectionChange = (item) => {
			this.focusedThinkingLevel = item.value as ThinkingLevel;
		};
		this.addChild(this.thinkingList);
		this.addChild(new Spacer(1));
		this.addChild(new Text(this.theme.fg("dim", "↑/↓ move • space select • tab switch pane • enter apply • esc cancel"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
	}

	invalidate(): void {
		super.invalidate();
		this.rebuild();
	}

	private requestRender(): void {
		this.rebuild();
		this.tui.requestRender();
	}

	private switchPane(): void {
		if (this.focusPane === "models") {
			this.focusPane = "thinking";
			this.focusedThinkingLevel = clampThinkingLevel(this.selectedModel(), this.selectedThinkingLevel);
		} else {
			this.focusPane = "models";
		}
		this.requestRender();
	}

	private selectFocusedModel(): void {
		this.selectedModelIndex = this.focusedModelIndex;
		this.selectedThinkingLevel = clampThinkingLevel(this.selectedModel(), this.selectedThinkingLevel);
		this.focusedThinkingLevel = this.selectedThinkingLevel;
		this.requestRender();
	}

	private selectFocusedThinking(): void {
		this.selectedThinkingLevel = clampThinkingLevel(this.selectedModel(), this.focusedThinkingLevel);
		this.focusedThinkingLevel = this.selectedThinkingLevel;
		this.requestRender();
	}

	private apply(): void {
		this.done({
			model: this.selectedModel(),
			thinkingLevel: clampThinkingLevel(this.selectedModel(), this.selectedThinkingLevel),
		});
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.done(null);
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.switchPane();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.apply();
			return;
		}
		if (matchesKey(data, Key.space)) {
			if (this.focusPane === "models") this.selectFocusedModel();
			else this.selectFocusedThinking();
			return;
		}

		if (this.focusPane === "models") {
			this.modelList?.handleInput(data);
			const current = this.modelList?.getSelectedItem();
			if (current) {
				this.focusedModelIndex = this.selectedModelIndexByKey(current.value);
				this.requestRender();
			}
			return;
		}

		this.thinkingList?.handleInput(data);
		const current = this.thinkingList?.getSelectedItem();
		if (current) {
			this.focusedThinkingLevel = current.value as ThinkingLevel;
			this.requestRender();
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
		(tui: any, theme: any, _keybindings: any, done: (value: SelectorResult | null) => void) =>
			new ModelThinkingSelectorView(tui, theme, models, currentModel, currentThinkingLevel, done),
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
			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("No active model", "warning");
				return;
			}

			await withDefaultWrites(async () => {
				const settings = SettingsManager.create(ctx.cwd);
				settings.setDefaultModelAndProvider(model.provider, model.id);
				settings.setDefaultThinkingLevel(pi.getThinkingLevel());
			});

			ctx.ui.notify(
				`Saved default model: ${model.provider}/${modelName(model)} • thinking:${pi.getThinkingLevel()}`,
				"info",
			);
		},
	});

	pi.registerShortcut("ctrl+alt+m", {
		description: "Open runtime model/thinking selector",
		handler: async (ctx) => {
			await openRuntimeSelector(pi, ctx);
		},
	});
}
