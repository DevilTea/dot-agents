import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, type Component } from "@earendil-works/pi-tui";

export type WheelDirection = 1 | -1;
export type WheelListener = (direction: WheelDirection, raw: string) => void;

export type MouseEventKind = "press" | "release" | "drag" | "wheel" | "unknown";
export type MouseButton = "left" | "middle" | "right" | "none" | "unknown";

export type MouseEvent = {
	kind: MouseEventKind;
	button: MouseButton;
	buttonCode: number;
	x: number;
	y: number;
	direction?: WheelDirection;
	raw: string;
};

export type MouseBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type MouseRegionMatcher = (event: MouseEvent) => boolean;

export type MouseRegion = {
	id?: string;
	bounds?: MouseBounds | (() => MouseBounds | undefined);
	contains?: MouseRegionMatcher;
	zIndex?: number;
};

export type MouseListener = (event: MouseEvent) => void;
export type MouseListenerOptions = MouseRegion;

type RegisteredMouseListener = {
	listener: MouseListener;
	region?: MouseListenerOptions;
	filter?: MouseRegionMatcher;
	order: number;
};

type TerminalWriter = {
	write(data: string): void;
};

type MouseTrackingState = {
	enabled: boolean;
	removeInputListener?: () => void;
};

type MouseTrackingGlobals = {
	mouseHandler?: MouseHandler;
	state?: MouseTrackingState;
};

const GLOBALS_KEY = Symbol.for("pi-mouse-tracking.globals");

function globals(): MouseTrackingGlobals {
	const target = globalThis as typeof globalThis & { [GLOBALS_KEY]?: MouseTrackingGlobals };
	if (!target[GLOBALS_KEY]) target[GLOBALS_KEY] = {};
	return target[GLOBALS_KEY];
}

export type MouseHandler = {
	onWheel(listener: WheelListener, region?: MouseListenerOptions): () => void;
	onMouse(listener: MouseListener, region?: MouseListenerOptions): () => void;
	registerRegion(region: MouseRegion): () => void;
	handleInput(data: string): boolean;
	parseMouseEvent(data: string): MouseEvent | undefined;
	parseWheelDirection(data: string): WheelDirection | undefined;
	isTrackingEnabled(): boolean;
};

type InternalMouseHandler = MouseHandler & {
	setTrackingEnabled(enabled: boolean): void;
};

export type MouseRegionContainerOptions = MouseRegion & {
	onMouse?: MouseListener;
	onWheel?: WheelListener;
};

export class MouseRegionContainer implements Component {
	private readonly removeListeners: Array<() => void> = [];

	constructor(
		private readonly child: Component,
		mouseHandler: MouseHandler,
		options: MouseRegionContainerOptions,
	) {
		const { onMouse, onWheel, ...region } = options;
		if (onMouse) this.removeListeners.push(mouseHandler.onMouse(onMouse, region));
		if (onWheel) this.removeListeners.push(mouseHandler.onWheel(onWheel, region));
	}

	render(width: number): string[] {
		return this.child.render(width);
	}

	handleInput(data: string): void {
		this.child.handleInput?.(data);
	}

	invalidate(): void {
		this.child.invalidate?.();
	}

	dispose(): void {
		for (const remove of this.removeListeners.splice(0)) remove();
		(this.child as Component & { dispose?(): void }).dispose?.();
	}
}

function getBounds(region: MouseRegion): MouseBounds | undefined {
	if (!region.bounds) return undefined;
	return typeof region.bounds === "function" ? region.bounds() : region.bounds;
}

function eventInBounds(event: MouseEvent, bounds: MouseBounds): boolean {
	if (bounds.width <= 0 || bounds.height <= 0) return false;
	return event.x >= bounds.x
		&& event.x < bounds.x + bounds.width
		&& event.y >= bounds.y
		&& event.y < bounds.y + bounds.height;
}

function matchesRegion(event: MouseEvent, region: MouseRegion | undefined): boolean {
	if (!region) return true;
	if (region.contains?.(event)) return true;
	const bounds = getBounds(region);
	return bounds ? eventInBounds(event, bounds) : false;
}

function mouseButtonFromCode(buttonCode: number): MouseButton {
	const button = buttonCode & 3;
	if (button === 0) return "left";
	if (button === 1) return "middle";
	if (button === 2) return "right";
	if (button === 3) return "none";
	return "unknown";
}

function createMouseHandler(): MouseHandler {
	const mouseListeners = new Set<RegisteredMouseListener>();
	const regions = new Set<MouseRegion>();
	let listenerOrder = 0;
	let trackingEnabled = false;

	function parseMouseEvent(data: string): MouseEvent | undefined {
		const match = data.match(/^\x1b\[<(\d+);(\d+);(\d+)([mM])$/);
		if (!match) return undefined;

		const buttonCode = Number(match[1]);
		const x = Number(match[2]);
		const y = Number(match[3]);
		const final = match[4];
		if (!Number.isFinite(buttonCode) || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;

		const baseCode = buttonCode & ~28;
		const direction = baseCode === 64 ? -1 : baseCode === 65 ? 1 : undefined;
		const isWheel = direction !== undefined;
		const isRelease = final === "m";
		const isDrag = !isWheel && !isRelease && (buttonCode & 32) === 32;
		const kind: MouseEventKind = isWheel ? "wheel" : isRelease ? "release" : isDrag ? "drag" : "press";

		return {
			kind,
			button: isWheel ? "none" : mouseButtonFromCode(buttonCode),
			buttonCode,
			x,
			y,
			direction,
			raw: data,
		};
	}

	function parseWheelDirection(data: string): WheelDirection | undefined {
		return parseMouseEvent(data)?.direction;
	}

	function addMouseListener(listener: MouseListener, region?: MouseListenerOptions, filter?: MouseRegionMatcher): () => void {
		const registered: RegisteredMouseListener = { listener, region, filter, order: listenerOrder++ };
		mouseListeners.add(registered);
		return () => {
			mouseListeners.delete(registered);
		};
	}

	return {
		onWheel(listener: WheelListener, region?: MouseListenerOptions): () => void {
			return addMouseListener((event) => listener(event.direction!, event.raw), region, (event) => event.kind === "wheel" && event.direction !== undefined);
		},
		onMouse(listener: MouseListener, region?: MouseListenerOptions): () => void {
			return addMouseListener(listener, region);
		},
		registerRegion(region: MouseRegion): () => void {
			regions.add(region);
			return () => {
				regions.delete(region);
			};
		},
		handleInput(data: string): boolean {
			if (!trackingEnabled) return false;
			const event = parseMouseEvent(data);
			if (!event) return false;

			const matchedRegion = regions.size === 0 || [...regions].some((region) => matchesRegion(event, region));
			if (!matchedRegion) return false;

			let handled = false;
			const listeners = [...mouseListeners].sort((a, b) => (b.region?.zIndex ?? 0) - (a.region?.zIndex ?? 0) || b.order - a.order);
			for (const { listener, region, filter } of listeners) {
				if (filter && !filter(event)) continue;
				if (!matchesRegion(event, region)) continue;
				listener(event);
				handled = true;
			}
			return handled;
		},
		parseMouseEvent,
		parseWheelDirection,
		isTrackingEnabled: () => trackingEnabled,
		setTrackingEnabled: (enabled: boolean) => {
			trackingEnabled = enabled;
		},
	} as InternalMouseHandler;
}

function setMouseTrackingEnabled(mouseHandler: MouseHandler, enabled: boolean, writer: TerminalWriter): void {
	(mouseHandler as InternalMouseHandler).setTrackingEnabled(enabled);
	writer.write(enabled ? "\x1b[?1000h\x1b[?1006h" : "\x1b[?1000l\x1b[?1006l");
}

export function getMouseHandler(_pi: ExtensionAPI): MouseHandler {
	const state = globals();
	if (!state.mouseHandler) state.mouseHandler = createMouseHandler();
	return state.mouseHandler;
}

function getMouseTrackingState(_pi: ExtensionAPI): MouseTrackingState {
	const state = globals();
	if (!state.state) state.state = { enabled: false };
	return state.state;
}

function setStatus(ctx: ExtensionContext, enabled: boolean): void {
	ctx.ui.setStatus("mouse-tracking", enabled ? "mouse:on" : undefined);
}

export function setSharedMouseTracking(pi: ExtensionAPI, ctx: ExtensionContext, enabled: boolean): void {
	if (!ctx.hasUI) return;
	const state = getMouseTrackingState(pi);
	if (state.enabled === enabled) return;
	state.enabled = enabled;
	setMouseTrackingEnabled(getMouseHandler(pi), enabled, process.stdout);
	setStatus(ctx, enabled);
	ctx.ui.notify(`Mouse tracking ${enabled ? "enabled" : "disabled"}`, "info");
}

export function toggleSharedMouseTracking(pi: ExtensionAPI, ctx: ExtensionContext): void {
	setSharedMouseTracking(pi, ctx, !getMouseTrackingState(pi).enabled);
}

export function matchesMouseTrackingToggle(data: string): boolean {
	return matchesKey(data, "ctrl+shift+m");
}

export function handleMouseTrackingInput(pi: ExtensionAPI, ctx: ExtensionContext, data: string): boolean {
	if (matchesMouseTrackingToggle(data)) {
		toggleSharedMouseTracking(pi, ctx);
		return true;
	}
	return getMouseHandler(pi).handleInput(data);
}

export default function mouseTrackingExtension(pi: ExtensionAPI) {
	const mouseHandler = getMouseHandler(pi);
	const state = getMouseTrackingState(pi);

	pi.registerCommand("mouse", {
		description: "Toggle shared mouse tracking for mouse-aware extension regions",
		handler: async (_args, ctx) => toggleSharedMouseTracking(pi, ctx),
	});

	pi.registerShortcut("ctrl+shift+m", {
		description: "Toggle shared mouse tracking",
		handler: async (ctx) => toggleSharedMouseTracking(pi, ctx),
	});

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		state.removeInputListener?.();
		state.removeInputListener = ctx.ui.onTerminalInput((data) => {
			return mouseHandler.handleInput(data) ? { consume: true } : undefined;
		});
		setStatus(ctx, state.enabled);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		state.removeInputListener?.();
		state.removeInputListener = undefined;
		if (state.enabled && ctx.hasUI) {
			setMouseTrackingEnabled(mouseHandler, false, process.stdout);
			state.enabled = false;
			setStatus(ctx, false);
		}
	});
}
