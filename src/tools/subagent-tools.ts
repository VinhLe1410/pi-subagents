import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { AgentDefaults } from "../agents/definitions.ts";
import {
	enforceAgentFrontmatter,
	getSubagentAgentRequirementError,
} from "../launch/policy.ts";
import type { SubagentLaunchContext } from "../launch/prep.ts";
import type { RunningSubagent, SubagentParamsInput, SubagentResult } from "../types.ts";
import { asSubagentToolResult } from "../runtime/state.ts";

import { formatSubagentBatchLines, formatTaskPreview, renderSubagentCompletionText } from "./message-renderers.ts";
import { getSubagentToolsWarning } from "./policy.ts";
import { SUBAGENT_TOOL_NAME } from "./tool-names.ts";

let initialPromptLaunchActive = isInitialPromptInvocation();

const SUBAGENT_NAME_DESCRIPTION =
	"Required machine handle for this launch. Use lower-kebab <scope>-<role>, 2-4 words, max 32 chars, matching ^[a-z][a-z0-9]*(?:-[a-z0-9]+){1,3}$; examples: auth-scout, diff-reviewer, session-tester. Do not use Title Case, spaces, underscores, generic names, or prose.";

const SUBAGENT_TITLE_DESCRIPTION =
	"Required human title for this child session/widget. Use sentence case, 3-8 words, outcome/objective focused, and not a prompt or instruction; examples: Auth implementation map, Local diff bug review.";

const TASK_DESCRIPTION = "Required task prompt. Keep it small, concrete, and self-contained; include context, scope, constraints, completion criteria, and expected output.";

const SubagentChildParams = Type.Object({
	name: Type.String({ description: SUBAGENT_NAME_DESCRIPTION }),
	task: Type.String({ description: TASK_DESCRIPTION }),
	title: Type.String({ description: SUBAGENT_TITLE_DESCRIPTION }),
	agent: Type.String({ description: "Required exact agent definition name from the subagent roster. Reads .pi/agents/<name>.md or ~/.pi/agent/agents/<name>.md." }),
});

const SubagentParams = Type.Object({
	children: Type.Array(SubagentChildParams, {
		description: "Required array of subagent launches. Use this for every call, including a single subagent. Launch independent children together when work can run in parallel.",
		minItems: 1,
	}),
});

type ToolResult = ReturnType<typeof asSubagentToolResult>;

export interface SubagentToolRuntime {
	loadAgentDefaults(agentName: string | undefined, cwd: string): AgentDefaults | null;
	resolveEffectiveSessionMode(params: Partial<SubagentParamsInput>, defs: AgentDefaults | null): string;
	resolveTaskSessionMode(defs: AgentDefaults): string;
	launchBackgroundSubagent(params: SubagentParamsInput, ctx: SubagentLaunchContext): Promise<RunningSubagent>;
	watchBackgroundSubagent(running: RunningSubagent, signal: AbortSignal, timeout?: number): Promise<SubagentResult>;
	getWatcherSignal(running: RunningSubagent, controller: AbortController): AbortSignal;
	startWidgetRefresh(): void;
	getLaunchedSubagentResult(running: RunningSubagent, signal?: AbortSignal): Promise<ToolResult>;
}

type SubagentToolParams = { children?: SubagentParamsInput[] };

function getRequestedChildren(params: SubagentToolParams): SubagentParamsInput[] {
	if (Array.isArray(params.children) && params.children.length > 0) return params.children;
	throw new Error("Error: subagent calls must use children:[...] with at least one child, even for a single subagent launch.");
}

export function getSubagentNameError(name: string | undefined): string | null {
	const trimmed = name?.trim();
	if (!trimmed) {
		return "Error: name is required for subagent launches. Provide a lower-kebab <scope>-<role> handle like auth-scout, diff-reviewer, or session-tester.";
	}
	if (trimmed !== name) {
		return `Error: subagent name ${JSON.stringify(name)} has surrounding whitespace. Use lower-kebab <scope>-<role>, e.g. auth-scout.`;
	}
	if (trimmed.length > 32) {
		return `Error: subagent name ${JSON.stringify(name)} is too long. Use 2-4 lower-kebab words and keep it at 32 characters or fewer.`;
	}
	if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+){1,3}$/.test(trimmed)) {
		return `Error: subagent name ${JSON.stringify(name)} must be lower-kebab <scope>-<role> with 2-4 words, e.g. auth-scout, diff-reviewer, or session-tester. Do not use spaces, underscores, Title Case, or prose.`;
	}
	return null;
}

export function withToolWarning(result: ToolResult, warningPrefix: string): ToolResult {
	if (!warningPrefix) return result;
	const existingText = result.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n\n");
	// Spread the original result so structured details survive; only the text
	// content is prepended with the warning.
	return asSubagentToolResult({
		...result,
		content: [{ type: "text", text: `${warningPrefix}\n\n${existingText}` }],
	});
}

function enrichChildDetail(
	resultDetails: unknown,
	child: SubagentParamsInput | undefined,
): Record<string, unknown> {
	const details = resultDetails as Record<string, unknown> | undefined;
	return {
		...(details ?? {}),
		task: child?.task,
		title: child?.title,
		agent: child?.agent,
		name: (details as { name?: string } | undefined)?.name ?? child?.name ?? "subagent",
	};
}

function batchChildSnapshot(
	resultDetails: unknown,
	child: SubagentParamsInput | undefined,
): Record<string, unknown> {
	if (resultDetails) return enrichChildDetail(resultDetails, child);
	return {
		task: child?.task,
		title: child?.title,
		agent: child?.agent,
		name: child?.name ?? "subagent",
		status: "running",
	};
}

function getLaunchError(params: SubagentParamsInput, agentDefs: AgentDefaults | null, currentAgent: string | undefined): string | null {
	const nameError = getSubagentNameError(params.name);
	if (nameError) return nameError;
	if (!params.title?.trim()) return "Error: title is required for subagent launches. Provide a short sentence-case title for the child session/widget.";
	const agentError = getSubagentAgentRequirementError(params, agentDefs);
	if (agentError) return agentError.content[0]?.text ?? "Agent requirement error";
	if (params.agent && currentAgent && params.agent === currentAgent) {
		return `You are the ${currentAgent} agent — do not start another ${currentAgent}. You were spawned to do this work yourself. Complete the task directly.`;
	}
	return null;
}

async function launchOneSubagent(
	toolCallId: string,
	params: SubagentParamsInput,
	agentDefs: AgentDefaults | null,
	ctx: ExtensionContext,
	runtime: SubagentToolRuntime,
	pi: ExtensionAPI,
): Promise<RunningSubagent> {
	const effectiveParams = enforceAgentFrontmatter(params, agentDefs);

	const parentModelRef = ctx.model
		? `${ctx.model.provider}/${ctx.model.id}`
		: undefined;
	const parentThinking = pi.getThinkingLevel() as string;

	const launchCtx: SubagentLaunchContext = {
		sessionManager: ctx.sessionManager,
		cwd: ctx.cwd,

		launchToolCallId: toolCallId,
		autoExit: true,
		modelRegistry: ctx.modelRegistry,
		parentModelRef,
		parentThinking,
	};
	const running = await runtime.launchBackgroundSubagent(effectiveParams, launchCtx);
	const watcherAbort = new AbortController();
	running.abortController = watcherAbort;
	running.completionPromise = runtime.watchBackgroundSubagent(running, runtime.getWatcherSignal(running, watcherAbort), agentDefs?.timeout);
	return running;
}

export function isOneShotPromptInvocation(argv = process.argv): boolean {
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--print" || arg === "-p") return true;
		if (arg === "--mode" && (argv[i + 1] === "json" || argv[i + 1] === "rpc")) {
			return true;
		}
	}
	return false;
}

function hasInitialPromptArgument(argv = process.argv): boolean {
	const optionsWithValue = new Set([
		"--provider",
		"--model",
		"--api-key",
		"--system-prompt",
		"--append-system-prompt",
		"--mode",
		"--session",
		"--fork",
		"--session-dir",
		"--tools",
		"--extension",
		"-e",
		"--skill",
		"--prompt-template",
		"--theme",
		"--thinking",
		"--export",
		"--list-models",
	]);
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--") return i + 1 < argv.length;
		if (optionsWithValue.has(arg)) {
			i++;
			continue;
		}
		if (arg.startsWith("-")) continue;
		if (arg.startsWith("@")) continue;
		return true;
	}
	return false;
}

export function isInitialPromptInvocation(argv = process.argv): boolean {
	return !isOneShotPromptInvocation(argv) && hasInitialPromptArgument(argv);
}

export function markInitialPromptLaunchComplete(): void {
	initialPromptLaunchActive = false;
}

export function shouldForceSynchronousLaunch(
	hasUI: boolean,
	argv = process.argv,
): boolean {
	const startupPromptActive = argv === process.argv
		? initialPromptLaunchActive
		: isInitialPromptInvocation(argv);
	return !hasUI || isOneShotPromptInvocation(argv) || startupPromptActive;
}

export function registerSubagentCoreTools(
	pi: ExtensionAPI,
	shouldRegister: (name: string) => boolean,
	runtime: SubagentToolRuntime,
): void {
	if (shouldRegister(SUBAGENT_TOOL_NAME)) pi.registerTool({
		name: SUBAGENT_TOOL_NAME,
		label: "Subagent",
		description:
			"Launch one or more named helper agents from the subagent roster and wait for completion. " +
			"Calls must use children:[...] even for a single subagent. Agent definitions own model, tools, and prompt behavior.",
		promptSnippet:
			"Subagents are separate hidden helper processes, and this tool waits for their completion and returns their results as tool output.\n" +
			"\n" +
			"Use this tool when a listed agent is a clear fit for a small slice of complex work, or for parallel work. Subagents are not as smart; do not hand them complex work.\n" +
			"\n" +
			"How to call:\n" +
			"- Always call with children:[...], even for one subagent.\n" +
			"- Use exact agent names from the roster. Do not invent or substitute agents.\n" +
			"- Every child must include name, title, agent, and task.\n" +
			"- name is a lower-kebab machine handle; title is a short human label.\n" +
			"\n" +
			"Writing tasks:\n" +
			"- Children do not have previous conversation context by default.\n" +
			"- Keep each child task small, concrete, and self-contained.\n" +
			"- Include objective, needed context, scope, relevant files/facts, constraints, completion criteria, and expected output.\n" +
			"- For parallel helpers, make each task independent and non-overlapping.\n" +
			"\n" +
			"After launch: use the returned findings; do not poll, sleep-read, or inspect session files unless debugging.\n",
		parameters: SubagentParams,
		execute: async (toolCallId, params, signal, onUpdate, ctx) => {
			const children = getRequestedChildren(params as SubagentToolParams);
			const currentAgent = process.env.PI_SUBAGENT_AGENT;
			const prepared = children.map((child) => {
				const agentDefs = runtime.loadAgentDefaults(child.agent, ctx.cwd);
				const error = getLaunchError(child, agentDefs, currentAgent);
				if (error) throw new Error(error);
				return { child, agentDefs, warning: getSubagentToolsWarning(agentDefs?.tools) };
			});

			const launched: RunningSubagent[] = [];
			for (const entry of prepared) {
				const running = await launchOneSubagent(toolCallId, entry.child, entry.agentDefs, ctx, runtime, pi);
				launched.push(running);
			}
			runtime.startWidgetRefresh();
			const warnings = prepared.map((entry) => entry.warning?.message ?? "");
			const warningPrefix = warnings.filter(Boolean).join("\n\n");
			if (launched.length === 1) {
				const result = await runtime.getLaunchedSubagentResult(launched[0], signal);
				return withToolWarning(result, warningPrefix);
			}

			const childDetails: (Record<string, unknown> | undefined)[] = new Array(launched.length).fill(undefined);
			const emitBatchPartial = () => {
				onUpdate?.({
					content: [],
					details: {
						status: "batch_partial",
						children: childDetails.map((detail, index) => batchChildSnapshot(detail, prepared[index]?.child)),
					},
				});
			};
			const results = await Promise.all(
				launched.map(async (running, index) => {
					const result = await runtime.getLaunchedSubagentResult(running, signal);
					childDetails[index] = result.details as Record<string, unknown> | undefined;
					emitBatchPartial();
					return result;
				}),
			);
			const texts = results.flatMap((result) => result.content).filter((block) => block.type === "text").map((block) => block.text);
			const joined = texts.join("\n\n");
			return asSubagentToolResult({
				content: [{ type: "text", text: warningPrefix ? `${warningPrefix}\n\n${joined}` : joined }],
				details: {
					status: "batch",
					children: results.map((result, index) => enrichChildDetail(result.details, prepared[index]?.child)),
				},
			});
		},
		renderCall(args, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const children = Array.isArray(args.children) ? args.children : [];
			const label = children.length === 1 ? "1 agent" : `${children.length} agents`;
			const lines = [`▸ ${theme.fg("toolTitle", theme.bold("Spawn"))} ${theme.fg("toolTitle", theme.bold(label))}`, ""];
			children.forEach((child, index) => {
				if (index > 0) lines.push("");
				const agent = child.agent ? theme.fg("dim", ` (${child.agent})`) : "";
				lines.push(`${theme.fg("accent", theme.bold(child.name ?? "subagent"))}${agent}`);
				const taskPreview = formatTaskPreview(child.task, context, theme).replace(/^\n/, "");
				if (taskPreview) lines.push(taskPreview);
			});
			text.setText(lines.join("\n"));
			return text;
		},
		renderResult(result, options, theme, context) {
			const details = result.details as { status?: string; children?: unknown[] } | undefined;
			if (details?.children) {
				if (details.status !== "batch") return new Text("", 0, 0);
				const component = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
				component.setText(`\n${formatSubagentBatchLines(result, context.args, options, theme).join("\n")}`);
				return component;
			}
			if (details?.status !== "completed" && details?.status !== "failed" && details?.status !== "cancelled") {
				return new Text("", 0, 0);
			}
			return renderSubagentCompletionText(result, options, theme, context.lastComponent instanceof Text ? context.lastComponent : undefined, true);
		},
	});

}
