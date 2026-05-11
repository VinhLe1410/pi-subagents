import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { findRunningSubagent } from "../runtime/running-registry.ts";
import type { RunningSubagent } from "../types.ts";
import type { AgentDefaults } from "../agents/definitions.ts";

export interface SubagentCommandRuntime {
	loadAgentDefaults(agentName: string, cwd: string): AgentDefaults | null;
	stopRunningSubagent(running: RunningSubagent): void;
}

export function registerSubagentCommands(
	pi: ExtensionAPI,
	runtime: SubagentCommandRuntime,
): void {
	pi.registerCommand("iterate", {
		description: "Fork session into the named iterate agent for focused work",
		handler: async (args, ctx) => {
			const task = args?.trim() || "";
			const agentName = "iterate";
			const defs = runtime.loadAgentDefaults(agentName, ctx.cwd);
			if (!defs) {
				ctx.ui.notify(
					'/iterate now requires an existing "iterate" agent. Create that agent or use /subagent <agent> <task>.',
					"error",
				);
				return;
			}
			const taskText =
				task ||
				"The user wants to do some hands-on work. Help them with whatever they need.";
			const toolCall = `Use subagent with agent: "${agentName}", fork: true, name: "Iterate", task: ${JSON.stringify(taskText)}`;
			pi.sendUserMessage(toolCall);
		},
	});

	pi.registerCommand("subagent", {
		description: "Spawn a subagent: /subagent <agent> <task>",
		handler: async (args, ctx) => {
			const trimmed = (args ?? "").trim();
			if (!trimmed) {
				ctx.ui.notify("Usage: /subagent <agent> [task]", "warning");
				return;
			}

			const spaceIdx = trimmed.indexOf(" ");
			const agentName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
			const task = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

			const defs = runtime.loadAgentDefaults(agentName, ctx.cwd);
			if (!defs) {
				ctx.ui.notify(
					`Agent "${agentName}" not found in the global agent config or .pi/agents/`,
					"error",
				);
				return;
			}

			const taskText =
				task || `You are the ${agentName} agent. Wait for instructions.`;
			const displayName = agentName[0].toUpperCase() + agentName.slice(1);
			const toolCall = `Use subagent with agent: "${agentName}", name: "${displayName}", task: ${JSON.stringify(taskText)}`;
			pi.sendUserMessage(toolCall);
		},
	});

	pi.registerCommand("subagent-kill", {
		description: "Stop a running subagent: /subagent-kill <id|name>",
		handler: async (args, ctx) => {
			const query = (args ?? "").trim();
			if (!query) {
				ctx.ui.notify("Usage: /subagent-kill <id|name>", "warning");
				return;
			}

			const match = findRunningSubagent(query);
			if (!match.running) {
				ctx.ui.notify(match.error ?? "Subagent not found.", "error");
				return;
			}

			runtime.stopRunningSubagent(match.running);
			ctx.ui.notify(
				`Stopping subagent "${match.running.name}" (${match.running.id})`,
				"info",
			);
		},
	});
}
