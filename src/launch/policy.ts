import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { AgentDefaults } from "../agents/definitions.ts";
import { getAgentConfigDir } from "../agents/definitions.ts";
import type { ParentClosePolicy, SubagentParamsInput } from "../types.ts";

export function getSubagentAgentRequirementError(
	params: Partial<SubagentParamsInput>,
	agentDefs: AgentDefaults | null,
) {
	if (!params.agent) {
		return {
			content: [
				{
					type: "text" as const,
					text: "Error: agent is required for subagent launches.",
				},
			],
			details: { error: "agent_required" },
		};
	}
	if (!agentDefs) {
		const globalDir = join(getAgentConfigDir(), "agents");
		return {
			content: [
				{
					type: "text" as const,
					text: `Error: agent "${params.agent}" was not found in .pi/agents/ or ${globalDir}.`,
				},
			],
			details: { error: "agent_not_found", agent: params.agent },
		};
	}
	return null;
}

export function getSubagentAgentOverrideError(
	_params: Partial<SubagentParamsInput>,
	_agentDefs: AgentDefaults | null,
) {
	return null;
}

export function resolveSubagentBlocking(
	_params: Partial<SubagentParamsInput>,
	_agentDefs: AgentDefaults | null,
): boolean {
	return true;
}

export function resolveSubagentNoContextFiles(
	_agentDefs: AgentDefaults | null,
): boolean {
	return true;
}

export function resolveSubagentNoSession(
	_agentDefs: AgentDefaults | null,
): boolean {
	return false;
}

export function resolveSubagentParentClosePolicy(
	_agentDefs: AgentDefaults | null,
): ParentClosePolicy {
	return "terminate";
}

function isAgentRelativeExtensionSpec(spec: string): boolean {
	return spec.startsWith("./") || spec.startsWith("../");
}

function resolveExtensionSpec(spec: string, agentPath: string | undefined): string {
	if (spec === "~") return homedir();
	if (spec.startsWith("~/")) return join(homedir(), spec.slice(2));
	if (isAbsolute(spec)) return spec;
	if (isAgentRelativeExtensionSpec(spec) && agentPath) {
		return resolve(dirname(agentPath), spec);
	}
	return spec;
}

export function resolveSubagentExtensions(
	agentDefs: AgentDefaults | null,
): string[] {
	return agentDefs?.extensions?.map((spec) =>
		resolveExtensionSpec(spec, agentDefs.path),
	) ?? [];
}

export function enforceAgentFrontmatter(
	params: SubagentParamsInput,
	_agentDefs: AgentDefaults | null,
): SubagentParamsInput {
	return {
		name: params.name,
		task: params.task,
		title: params.title,
		agent: params.agent,
	};
}
