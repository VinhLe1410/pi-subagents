import type { AgentDefaults } from "../agents/definitions.ts";
import { SUBAGENT_TOOL_NAME } from "./tool-names.ts";

const BUILTIN_TOOL_NAMES = new Set([
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
]);

const KNOWN_TOOL_NAMES = new Set<string>([
	...BUILTIN_TOOL_NAMES,
]);

export function resolveDenyTools(_agentDefs: AgentDefaults | null): Set<string> {
	return new Set([SUBAGENT_TOOL_NAME]);
}

function parseToolNames(tools: string): string[] {
	return tools
		.split(",")
		.map((tool) => tool.trim())
		.filter(Boolean);
}

function damerauLevenshtein(a: string, b: string): number {
	const aChars = [...a];
	const bChars = [...b];
	const aLen = aChars.length;
	const bLen = bChars.length;
	if (aLen === 0) return bLen;
	if (bLen === 0) return aLen;

	const previousPrevious = new Array<number>(bLen + 1).fill(0);
	const previous = new Array<number>(bLen + 1);
	for (let j = 0; j <= bLen; j++) previous[j] = j;
	const current = new Array<number>(bLen + 1).fill(0);

	for (let i = 1; i <= aLen; i++) {
		current[0] = i;
		for (let j = 1; j <= bLen; j++) {
			const cost = aChars[i - 1] === bChars[j - 1] ? 0 : 1;
			current[j] = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + cost,
			);
			if (
				i > 1 &&
				j > 1 &&
				aChars[i - 1] === bChars[j - 2] &&
				aChars[i - 2] === bChars[j - 1]
			) {
				current[j] = Math.min(current[j], previousPrevious[j - 2] + 1);
			}
		}
		previousPrevious.splice(0, bLen + 1, ...previous);
		previous.splice(0, bLen + 1, ...current);
	}
	return previous[bLen];
}

function findLikelyBuiltinTypo(tool: string): string | null {
	let best: string | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const builtin of BUILTIN_TOOL_NAMES) {
		const distance = damerauLevenshtein(tool, builtin);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = builtin;
		}
	}
	return bestDistance === 1 ? best : null;
}

export interface SubagentToolsWarning {
	name: string;
	suggestion: string;
	message: string;
}

export function getSubagentToolsWarning(tools?: string): SubagentToolsWarning | null {
	if (!tools) return null;
	if (tools.trim().toLowerCase() === "all" || tools.trim().toLowerCase() === "none") {
		return null;
	}
	for (const name of parseToolNames(tools)) {
		if (KNOWN_TOOL_NAMES.has(name)) continue;
		const suggestion = findLikelyBuiltinTypo(name);
		if (suggestion) {
			return {
				name,
				suggestion,
				message:
					`Warning: tool ${JSON.stringify(name)} in tools: may be a typo of built-in "${suggestion}". ` +
					"Pi silently drops unknown tool names, so if this is a typo the child runs without it.",
			};
		}
	}
	return null;
}

function normalizeToolMode(
	tools?: string,
): "default" | "all" | "none" | "list" {
	if (!tools) return "default";
	const normalized = tools.trim().toLowerCase();
	if (normalized === "all") return "all";
	if (normalized === "none") return "none";
	return "list";
}

export function getSubagentToolAllowlist(
	tools?: string,
	_deniedTools = new Set<string>(),
): string[] {
	if (normalizeToolMode(tools) !== "list" || !tools) return [];
	return [...new Set(parseToolNames(tools))];
}

export function addToolModeDeniedNames(
	deniedTools: Set<string>,
	tools?: string,
) {
	if (normalizeToolMode(tools) !== "none") return deniedTools;
	for (const tool of BUILTIN_TOOL_NAMES) deniedTools.add(tool);
	return deniedTools;
}

export function getSubagentToolLaunchArgs(
	tools?: string,
	deniedTools = new Set<string>(),
): string[] {
	const args: string[] = [];
	const toolMode = normalizeToolMode(tools);
	if (toolMode === "none") {
		args.push("--no-builtin-tools");
	} else if (toolMode === "list") {
		const allowlist = getSubagentToolAllowlist(tools, deniedTools);
		if (allowlist.length > 0) args.push("--tools", allowlist.join(","));
		else args.push("--no-tools");
	}
	if (deniedTools.size > 0) args.push("--exclude-tools", [...deniedTools].join(","));
	return args;
}
