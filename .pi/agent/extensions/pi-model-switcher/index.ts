import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { Container, Key, matchesKey, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type SelectorMode = "runtime" | "default";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const STATUS_KEY = "pi-model-switcher";

const originalSetDefaultModelAndProvider = SettingsManager.prototype.setDefaultModelAndProvider;
const originalSetDefaultThinkingLevel = SettingsManager.prototype.setDefaultThinkingLevel;
let allowDefaultWrites = false;
let settingsGuardInstalled = false;

function installSettingsGuard() {
	if (settingsGuardInstalled) return;
	settingsGuardInstalled = true;

	// pi 0.74.x AgentSession.setModel()/setThinkingLevel() persists default model/thinking
	// through these SettingsManager methods. Runtime switching should not dirty settings.json;
	// /model-default temporarily re-enables the original methods intentionally.
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

function modelName(model: Model<any>): string {
	const maybeNamed = model as Model<any> & { name?: string };
	return maybeNamed.name || model.id;
}

function modelKey(model: Model<any>): string {
	return `${model.provider}/${model.id}`;
}

function modelLabel(model: Model<any>): string {
	return `${model.provider} ${modelName(model)}`;
}

function modelDescription(model: Model<any>, current: Model<any> | undefined): string {
	const parts = [`id: ${model.id}`];
	if (current && model.provider === current.provider && model.id === current.id) {
		parts.push("current");
	}
	return parts.join(" • ");
}

function thinkingDescription(level: ThinkingLevel, current: ThinkingLevel): string {
	return level === current ? "current" : "";
}

async function chooseFromItems(ctx: ExtensionContext, title: string, items: SelectItem[]): Promise<string | null> {
	if (!ctx.hasUI) {
		ctx.ui.notify("pi-model-switcher requires interactive UI", "warning");
		return null;
	}

	return await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
		container.addChild(new Text(theme.fg("accent", theme.bold(title))));

		const selectList = new SelectList(items, Math.min(items.length, 14), {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});

		selectList.onSelect = (item) => done(item.value);
		selectList.onCancel = () => done(null);

		container.addChild(selectList);
		container.addChild(new Text(theme.fg("dim", "↑↓ navigate • type filter • enter select • esc cancel")));
		container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));

		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				if (matchesKey(data, Key.escape)) {
					done(null);
					return;
				}
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

async function getAvailableModels(ctx: ExtensionContext): Promise<Model<any>[]> {
	ctx.modelRegistry.refresh();
	return await ctx.modelRegistry.getAvailable();
}

async function selectModel(ctx: ExtensionContext): Promise<Model<any> | null> {
	const models = await getAvailableModels(ctx);
	if (models.length === 0) {
		ctx.ui.notify("No available models", "warning");
		return null;
	}

	const byKey = new Map(models.map((model) => [modelKey(model), model]));
	const items: SelectItem[] = models
		.slice()
		.sort((a, b) => modelLabel(a).localeCompare(modelLabel(b)))
		.map((model) => ({
			value: modelKey(model),
			label: modelLabel(model),
			description: modelDescription(model, ctx.model),
		}));

	const selected = await chooseFromItems(ctx, "Select model", items);
	return selected ? byKey.get(selected) ?? null : null;
}

export default function piModelSwitcher(pi: ExtensionAPI) {
	installSettingsGuard();

	function currentThinkingLevel(): ThinkingLevel {
		return pi.getThinkingLevel() as ThinkingLevel;
	}

	async function selectThinkingLevelForPi(ctx: ExtensionContext): Promise<ThinkingLevel | null> {
		const current = currentThinkingLevel();
		const items: SelectItem[] = THINKING_LEVELS.map((level) => ({
			value: level,
			label: level,
			description: thinkingDescription(level, current),
		}));
		const selected = await chooseFromItems(ctx, "Select thinking level", items);
		return (selected as ThinkingLevel | null) ?? null;
	}

	async function runSelector(ctx: ExtensionContext, mode: SelectorMode): Promise<void> {
		const model = await selectModel(ctx);
		if (!model) return;

		const level = await selectThinkingLevelForPi(ctx);
		if (!level) return;

		const apply = async () => {
			const success = await pi.setModel(model);
			if (!success) {
				ctx.ui.notify(`No API key for ${model.provider}/${model.id}`, "error");
				return false;
			}
			pi.setThinkingLevel(level);
			return true;
		};

		const success = mode === "default" ? await withDefaultWrites(apply) : await apply();
		if (!success) return;

		const suffix = mode === "default" ? " and saved as default" : " for this runtime";
		ctx.ui.notify(`Model: ${model.provider}/${modelName(model)} • thinking:${pi.getThinkingLevel()}${suffix}`, "info");
		ctx.ui.setStatus(STATUS_KEY, `${model.provider}/${modelName(model)} thinking:${pi.getThinkingLevel()}`);
	}

	pi.registerCommand("ms", {
		description: "Switch runtime model and thinking level without changing defaults",
		handler: async (_args, ctx) => {
			await runSelector(ctx, "runtime");
		},
	});

	pi.registerCommand("model-switch", {
		description: "Switch runtime model and thinking level without changing defaults",
		handler: async (_args, ctx) => {
			await runSelector(ctx, "runtime");
		},
	});

	pi.registerCommand("model-default", {
		description: "Switch model and thinking level, then save them as defaults",
		handler: async (_args, ctx) => {
			await runSelector(ctx, "default");
		},
	});

	pi.registerShortcut("ctrl+l", {
		description: "Open runtime model/thinking selector",
		handler: async (ctx) => {
			await runSelector(ctx, "runtime");
		},
	});

	pi.on("model_select", async (event, ctx) => {
		ctx.ui.setStatus(STATUS_KEY, `${event.model.provider}/${modelName(event.model)} thinking:${pi.getThinkingLevel()}`);
	});

	pi.on("thinking_level_select", async (event, ctx) => {
		const model = ctx.model;
		if (model) {
			ctx.ui.setStatus(STATUS_KEY, `${model.provider}/${modelName(model)} thinking:${event.level}`);
		}
	});
}
