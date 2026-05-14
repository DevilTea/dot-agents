/**
 * Delegate Agent Discovery - Frontmatter parser & agent cache
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse } from "yaml";

// --- Types ---

/** Parsed frontmatter from an agent .md file */
export interface AgentDefinition {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
}

/** Cached agents: definition loaded at init, body loaded on demand */
interface AgentCacheEntry {
	definition: AgentDefinition;
	bodyLoaded: Promise<string>;
}

// --- Frontmatter parser (YAML-based) ---

function parseFrontmatter(content: string): { metadata: Record<string, unknown>; body: string } | null {
	const trimmed = content.trimStart();
	if (!trimmed.startsWith("---")) return null;

	const secondDash = trimmed.indexOf("---", 3);
	if (secondDash === -1) return null;

	const headerEnd = trimmed.indexOf("\n", secondDash + 3);
	if (headerEnd === -1) return null;

	const metadataText = trimmed.slice(3, headerEnd).trim();
	const body = trimmed.slice(headerEnd + 1).replace(/^\n/, "");

	let metadata: Record<string, unknown>;
	try {
		metadata = parse(metadataText) as Record<string, unknown>;
	} catch {
		return null;
	}

	if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
		return null;
	}

	return { metadata, body };
}

export function loadAgentDefinition(filePath: string): AgentDefinition | null {
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const parsed = parseFrontmatter(content);
		if (!parsed) return null;

		const meta = parsed.metadata as Record<string, unknown>;
		const tools = meta.tools;
		return {
			name: String(meta.name || path.basename(filePath, ".md")),
			description: String(meta.description || ""),
			tools: Array.isArray(tools) ? (tools.filter((t): t is string => typeof t === "string") as string[]) : undefined,
			model: meta.model ? String(meta.model) : undefined,
		};
	} catch {
		return null;
	}
}

export function loadAgentBody(filePath: string): string | null {
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const parsed = parseFrontmatter(content);
		return parsed?.body || null;
	} catch {
		return null;
	}
}

/** Discover and cache agent definitions from ~/.pi/agent/agents/*.md */
export function discoverAgents(agentsDir: string): Map<string, AgentDefinition> {
	const agents = new Map<string, AgentDefinition>();
	try {
		if (!fs.existsSync(agentsDir)) return agents;
		for (const entry of fs.readdirSync(agentsDir)) {
			if (!entry.endsWith(".md")) continue;
			const filePath = path.join(agentsDir, entry);
			const def = loadAgentDefinition(filePath);
			if (def) agents.set(def.name, def);
		}
	} catch {
		/* ignore discovery errors */
	}
	return agents;
}

// --- Agent cache ---

const AGENTS_DIR = path.join(os.homedir(), ".pi", "agent", "agents");
let agentCache: Map<string, AgentDefinition> | null = null;
const bodyCache = new Map<string, string>(); // name -> body (loaded on demand)

export function getAgentCache(): Map<string, AgentDefinition> {
	if (!agentCache) {
		agentCache = discoverAgents(AGENTS_DIR);
	}
	return agentCache;
}

export function loadAgent(name: string): { definition: AgentDefinition; body: string | null } | null {
	const cache = getAgentCache();
	const definition = cache.get(name);
	if (!definition) return null;

	let body: string | null = null;
	if (!bodyCache.has(name)) {
		const filePath = path.join(AGENTS_DIR, `${name}.md`);
		body = loadAgentBody(filePath);
		if (body !== null) bodyCache.set(name, body);
	} else {
		body = bodyCache.get(name) || null;
	}

	return { definition, body };
}

export function listAvailableAgents(): Array<{ name: string; description: string }> {
	const cache = getAgentCache();
	const result: Array<{ name: string; description: string }> = [];
	for (const [name, def] of Array.from(cache.entries())) {
		result.push({ name, description: def.description });
	}
	return result.sort((a, b) => a.name.localeCompare(b.name));
}

export { AGENTS_DIR };
