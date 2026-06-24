import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface AgentDefaults {
	model?: string;
	tools?: string;
	thinking?: string;
	systemPromptMode?: "append" | "replace";
	path?: string;
	body?: string;
	timeout?: number;
	extensions?: string[];
}

export interface ResolvedAgentDefinition extends AgentDefaults {
	name: string;
	description?: string;
	source: "project" | "global";
	path: string;
}

export function getAgentConfigDir(): string {
	return join(homedir(), ".pi", "agent");
}

const SUPPORTED_FRONTMATTER_KEYS = new Set([
	"name",
	"description",
	"model",
	"thinking",
	"tools",
	"system-prompt",
	"timeout",
	"extensions",
]);

function getFrontmatterValue(frontmatter: string, key: string): string | undefined {
	const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
	return match ? match[1].trim() : undefined;
}

function validateAgentFrontmatter(frontmatter: string, path: string): void {
	const unsupported = frontmatter
		.split(/\r?\n/)
		.map((line) => line.match(/^([A-Za-z0-9_-]+):/))
		.filter((match): match is RegExpMatchArray => !!match)
		.map((match) => match[1])
		.filter((key) => !SUPPORTED_FRONTMATTER_KEYS.has(key));
	if (unsupported.length > 0) {
		throw new Error(
			`Unsupported agent frontmatter field${unsupported.length === 1 ? "" : "s"} in ${path}: ${unsupported.join(", ")}. ` +
				`Supported fields: ${[...SUPPORTED_FRONTMATTER_KEYS].join(", ")}.`,
		);
	}
}

function parseTimeout(raw: string | undefined, path: string): number | undefined {
	if (raw == null) return undefined;
	if (!/^\d+$/.test(raw)) {
		throw new Error(`Invalid timeout in ${path}: expected a positive integer number of seconds.`);
	}
	const timeout = Number(raw);
	if (!Number.isSafeInteger(timeout) || timeout <= 0) {
		throw new Error(`Invalid timeout in ${path}: expected a positive integer number of seconds.`);
	}
	return timeout;
}

function parseSystemPromptMode(raw: string | undefined, path: string): "append" | "replace" {
	if (raw == null) return "replace";
	if (raw === "append" || raw === "replace") return raw;
	throw new Error(`Invalid system-prompt in ${path}: expected "append" or "replace".`);
}

function parseExtensions(raw: string | undefined): string[] | undefined {
	const extensions = raw
		?.split(",")
		.map((extension) => extension.trim())
		.filter(Boolean);
	return extensions && extensions.length > 0 ? extensions : undefined;
}

function parseAgentDefinition(
	path: string,
	source: "project" | "global",
): ResolvedAgentDefinition | null {
	const content = readFileSync(path, "utf8");
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return null;
	const frontmatter = match[1];
	validateAgentFrontmatter(frontmatter, path);
	const get = (key: string) => getFrontmatterValue(frontmatter, key);
	const systemPromptRaw = get("system-prompt");
	const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
	return {
		name: get("name") ?? basename(path, ".md"),
		description: get("description"),
		source,
		path,
		model: get("model"),
		tools: get("tools"),
		thinking: get("thinking"),
		systemPromptMode: parseSystemPromptMode(systemPromptRaw, path),
		body: body || undefined,
		timeout: parseTimeout(get("timeout"), path),
		extensions: parseExtensions(get("extensions")),
	};
}

export type ResolveAgentCwd = (cwdHint: string | null, baseCwd: string) => string;

export function getEffectiveAgentDefinitions(
	baseCwd = process.cwd(),
): ResolvedAgentDefinition[] {
	const configDir = getAgentConfigDir();
	const agents = new Map<string, ResolvedAgentDefinition>();
	const dirs = [
		{
			path: join(configDir, "agents"),
			source: "global" as const,
		},
		{
			path: join(baseCwd, ".pi", "agents"),
			source: "project" as const,
		},
	];
	for (const { path: dir, source } of dirs) {
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir)
			.filter((entry) => entry.endsWith(".md"))
			.sort((a, b) => a.localeCompare(b))) {
			const definition = parseAgentDefinition(join(dir, file), source);
			if (!definition) continue;
			agents.set(definition.name, definition);
		}
	}
	return [...agents.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadAgentDefaults(
	agentName: string,
	cwdHint: string | null | undefined,
	baseCwd: string,
	resolveAgentCwd: ResolveAgentCwd,
): AgentDefaults | null {
	const resolvedBaseCwd = resolveAgentCwd(cwdHint ?? null, baseCwd);
	return (
		getEffectiveAgentDefinitions(resolvedBaseCwd).find(
			(agent) => agent.name === agentName,
		) ?? null
	);
}
