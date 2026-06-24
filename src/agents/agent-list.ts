import type { ResolvedAgentDefinition } from "./definitions.ts";
import { getEffectiveAgentDefinitions } from "./definitions.ts";

export interface AgentListEntry {
	name: string;
	source: "project" | "global";
	description?: string;
}

export type ResolveSubagentSessionMode = (
	agent: ResolvedAgentDefinition,
) => "standalone" | "lineage-only" | "fork";

export function getAgentListEntries(
	baseCwd: string,
	_resolveSessionMode: ResolveSubagentSessionMode,
): AgentListEntry[] {
	return getEffectiveAgentDefinitions(baseCwd)
		.filter((agent) => agent.description?.trim())
		.map((agent) => ({
			name: agent.name,
			source: agent.source,
			description: agent.description,
		}));
}

export function renderAgentListReminder(
	entries: AgentListEntry[],
): string {
	const agentLines = entries.map((entry) => `- \`${entry.name}\`: ${entry.description}`);
	const body = [
		"Subagent roster:",
		"<subagent-roster>",
		agentLines.join("\n"),
		"</subagent-roster>",
	].join("\n");
	return `<system-reminder>\n${body}\n</system-reminder>`;
}

export function getAgentListSignature(
	entries: AgentListEntry[],
): string {
	return JSON.stringify(
		entries.map((entry) => ({
			name: entry.name,
			source: entry.source,
			description: entry.description,
		})),
	);
}
