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
		"You can launch separate helper agents with the subagent tool. Use this roster to choose exact agent names.",
		"<subagent-roster>",
		agentLines.join("\n"),
		"</subagent-roster>",
		"<subagent-rules>",
		"- Subagents do not have previous conversation context by default; always give the task proper context and completion criteria.",
		"- If the user names an agent that is not listed, say it was not found and stop; do not suggest a different listed agent.",
		"</subagent-rules>",
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
