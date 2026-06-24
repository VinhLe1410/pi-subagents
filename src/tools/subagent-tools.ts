import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { AgentDefaults } from "../agents/definitions.ts";
import {
	enforceAgentFrontmatter,
	getSubagentAgentRequirementError,
} from "../launch/policy.ts";
import type { SubagentLaunchContext } from "../launch/prep.ts";
import { findRunningSubagent } from "../runtime/running-registry.ts";
import type { RunningSubagent, SubagentParamsInput, SubagentResult } from "../types.ts";
import { asSubagentToolResult } from "../runtime/state.ts";

import { formatSubagentBatchLines, formatTaskPreview, renderSubagentCompletionText } from "./message-renderers.ts";
import { getSubagentToolsWarning } from "./policy.ts";
import {
	SUBAGENT_KILL_TOOL_NAME,
	SUBAGENT_TOOL_NAME,
} from "./tool-names.ts";

let initialPromptLaunchActive = isInitialPromptInvocation();

const SUBAGENT_NAME_DESCRIPTION =
	"Required machine handle for this launch. Use lower-kebab <scope>-<role>, 2-4 words, max 32 chars, matching ^[a-z][a-z0-9]*(?:-[a-z0-9]+){1,3}$; examples: auth-scout, diff-reviewer, session-tester. Do not use Title Case, spaces, underscores, generic names, or prose.";

const SUBAGENT_TITLE_DESCRIPTION =
	"Required human title for this child session/widget. Use sentence case, 3-8 words, outcome/objective focused, and not a prompt or instruction; examples: Auth implementation map, Local diff bug review.";

const SUBAGENT_MODEL_DESCRIPTION =
	"Model routing/cost control only. Omit unless the user named a concrete model for this launch. " +
	"Do not infer a model from quality, depth, urgency, safety, or cost language. " +
	"Never invent or upgrade models. Format: provider/model; put provider/model:thinking suffix in `thinking`.";

const SUBAGENT_THINKING_DESCRIPTION =
	"Child runtime thinking level only. Omit unless the user named a concrete thinking level for this launch. " +
	"Do not infer thinking from quality, depth, urgency, safety, or cost language. " +
	"Allowed: off|minimal|low|medium|high|xhigh.";

const SubagentChildParams = Type.Object({
	name: Type.String({ description: SUBAGENT_NAME_DESCRIPTION }),
	task: Type.String({ description: "Task/prompt for the sub-agent. For non-trivial work, write readable Markdown: short paragraphs, bullets, or headings as appropriate. Use a one-line task only for trivial work." }),
	title: Type.String({ description: SUBAGENT_TITLE_DESCRIPTION }),
	agent: Type.String({ description: "Required agent definition name. Reads .pi/agents/<name>.md or ~/.pi/agent/agents/<name>.md and refuses ad-hoc unnamed subagents." }),
	model: Type.Optional(Type.String({ description: SUBAGENT_MODEL_DESCRIPTION })),
	thinking: Type.Optional(Type.String({ description: SUBAGENT_THINKING_DESCRIPTION })),
});

const SubagentParams = Type.Object({
	name: Type.Optional(Type.String({ description: SUBAGENT_NAME_DESCRIPTION })),
	task: Type.Optional(Type.String({ description: "Task/prompt for a single sub-agent. For non-trivial work, write readable Markdown: short paragraphs, bullets, or headings as appropriate. Use a one-line task only for trivial work." })),
	title: Type.Optional(Type.String({ description: SUBAGENT_TITLE_DESCRIPTION })),
	agent: Type.Optional(Type.String({ description: "Required agent definition name for a single subagent launch." })),
	model: Type.Optional(Type.String({ description: SUBAGENT_MODEL_DESCRIPTION })),
	thinking: Type.Optional(Type.String({ description: SUBAGENT_THINKING_DESCRIPTION })),
	children: Type.Optional(Type.Array(SubagentChildParams, { description: "Spawn multiple children in one deterministic launch. Use this instead of multiple separate subagent tool calls when a user asks for more than one agent." })),
});
const SubagentKillParams = Type.Object({ id: Type.String({ description: "Running subagent id or display name to stop" }) });

type ToolResult = ReturnType<typeof asSubagentToolResult>;

export interface SubagentToolRuntime {
	loadAgentDefaults(agentName: string | undefined, cwd: string): AgentDefaults | null;
	resolveEffectiveSessionMode(params: Partial<SubagentParamsInput>, defs: AgentDefaults | null): string;
	resolveTaskSessionMode(defs: AgentDefaults): string;
	launchBackgroundSubagent(params: SubagentParamsInput, ctx: SubagentLaunchContext): Promise<RunningSubagent>;
	watchBackgroundSubagent(running: RunningSubagent, signal: AbortSignal, timeout?: number): Promise<SubagentResult>;
	getWatcherSignal(running: RunningSubagent, controller: AbortController): AbortSignal;
	wireSubagentSteerBack(pi: ExtensionAPI, running: RunningSubagent, promise: Promise<SubagentResult>): void;
	startWidgetRefresh(): void;
	getLaunchedSubagentResult(running: RunningSubagent, signal?: AbortSignal): Promise<ToolResult>;
	stopRunningSubagent(running: RunningSubagent): void;
}

type SubagentToolParams = Partial<SubagentParamsInput> & { children?: SubagentParamsInput[] };

function getRequestedChildren(params: SubagentToolParams): SubagentParamsInput[] {
	if (Array.isArray(params.children) && params.children.length > 0) return params.children;
	return [params as SubagentParamsInput];
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
	const forceSynchronousLaunch = shouldForceSynchronousLaunch(ctx.hasUI);
	const headlessAutoExit = forceSynchronousLaunch && agentDefs?.autoExit !== true ? true : undefined;
	const effectiveParams = enforceAgentFrontmatter(params, agentDefs);
	// Phase 2 runtime policy: obsolete async/blocking/background/mode config is
	// ignored for normal launches. Every child runs hidden and the tool waits for
	// completion before returning.
	effectiveParams.async = false;
	effectiveParams.blocking = true;
	effectiveParams.background = true;

	const parentModelRef = ctx.model
		? `${ctx.model.provider}/${ctx.model.id}`
		: undefined;
	const parentThinking = pi.getThinkingLevel() as string;

	const launchCtx: SubagentLaunchContext = {
		sessionManager: ctx.sessionManager,
		cwd: ctx.cwd,

		launchToolCallId: toolCallId,
		autoExit: headlessAutoExit,
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
			"Agent definitions own model, tools, and context; obsolete UI/wait fields are ignored. " +
			"This call chooses the agent name(s), task(s), and titles. " +
			"Model/thinking are routing controls, not quality knobs; set them only when the user named concrete values.",
		promptSnippet:
			"Subagents are separate helper processes you can launch to do work; this tool waits for their completion and returns the results as tool output.\n" +
			"\n" +
			"Use this tool when a listed agent is a clear fit for specialist, complex, or parallel work. Do small direct work yourself: quick answers, simple file reads, and tiny one-shot edits.\n" +
			"\n" +
			"Use exact agent names and behavior fields from the subagent roster when present; field meanings are defined in <subagent-rules>.\n" +
			"\n" +
			"How to call:\n" +
			"- Use exact roster names in agent fields.\n" +
			"- Always provide name and title. name is a machine handle: lower-kebab <scope>-<role>, 2-4 words, max 32 chars, e.g. auth-scout, diff-reviewer, session-tester. title is human prose: sentence case, 3-8 words, e.g. Auth implementation map.\n" +
			"- If launching one helper, pass agent/name/title/task normally.\n" +
			"- If launching multiple helpers for one user request, make one subagent call with children:[...] so all helpers start before any waiting happens.\n" +
			"- If the user names multiple agents, include each named agent exactly once. Do not substitute one agent for another.\n" +
			"- Leave model/thinking unset unless the user named concrete values. Do not infer them from quality, depth, urgency, safety, or cost language.\n" +
			"\n" +
			"Writing tasks:\n" +
			"- Translate the user's request into each helper's task; do not change the work just because of the agent name.\n" +
			"- For non-trivial work, write readable Markdown with objective, scope, relevant files/facts, constraints, and requested output.\n" +
			"- For parallel helpers, make each task non-overlapping.\n" +
			"\n" +
			"After launch:\n" +
			"- Wait for the tool result and use the returned findings; do not redo delegated work while the helper is running.\n" +
			"- Ask the user only when there is a plausible next step but ownership is ambiguous.\n" +
			"Results are returned directly by this tool. Do not poll, sleep-read, or check session files — the harness handles delivery.\n",
		parameters: SubagentParams,
		execute: async (toolCallId, params, _signal, _onUpdate, ctx) => {
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
				const result = await runtime.getLaunchedSubagentResult(launched[0]);
				return withToolWarning(result, warningPrefix);
			}

			const results = await Promise.all(launched.map((running) => runtime.getLaunchedSubagentResult(running)));
			const texts = results.flatMap((result) => result.content).filter((block) => block.type === "text").map((block) => block.text);
			const joined = texts.join("\n\n");
			return asSubagentToolResult({
				content: [{ type: "text", text: warningPrefix ? `${warningPrefix}\n\n${joined}` : joined }],
				details: {
					status: "batch",
					children: results.map((result, index) => ({
						...(result.details as Record<string, unknown>),
						task: prepared[index]?.child.task,
						title: prepared[index]?.child.title,
						agent: prepared[index]?.child.agent,
						name: (result.details as { name?: string } | undefined)?.name ?? prepared[index]?.child.name,
					})),
				},
			});
		},
		renderCall(args, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const children = Array.isArray(args.children) ? args.children : undefined;
			if (children?.length) {
				const lines = [`▸ ${theme.fg("toolTitle", theme.bold("Spawn"))} ${theme.fg("toolTitle", theme.bold(`${children.length} agents`))}`, ""];
				children.forEach((child, index) => {
					if (index > 0) lines.push("");
					const agent = child.agent ? theme.fg("dim", ` (${child.agent})`) : "";
					lines.push(`${theme.fg("accent", theme.bold(child.name ?? "subagent"))}${agent}`);
					const taskPreview = formatTaskPreview(child.task, context, theme).replace(/^\n/, "");
					if (taskPreview) lines.push(taskPreview);
				});
				text.setText(lines.join("\n"));
				return text;
			}
			const agent = args.agent ? theme.fg("dim", ` (${args.agent})`) : "";
			text.setText("▸ " + theme.fg("toolTitle", theme.bold("Spawn")) + " " + theme.fg("accent", theme.bold(args.name ?? "subagent")) + agent + formatTaskPreview(args.task, context, theme));
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

	pi.registerTool({
		name: SUBAGENT_KILL_TOOL_NAME, label: "Kill Subagent",
		description: "Stop a running background subagent by id or display name.",
		promptSnippet: "Stop a running background subagent by id or display name.",
		parameters: SubagentKillParams,
		execute: async (_toolCallId, params) => {
			const match = findRunningSubagent(params.id);
			if (!match.running) return asSubagentToolResult({ content: [{ type: "text" as const, text: match.error ?? "Subagent not found." }], details: { error: match.error ?? "not found" } });
			runtime.stopRunningSubagent(match.running);
			return asSubagentToolResult({ content: [{ type: "text" as const, text: `Stopping subagent "${match.running.name}" (${match.running.id}).` }], details: { id: match.running.id, name: match.running.name, status: "stopping" } });
		},
	});

}
