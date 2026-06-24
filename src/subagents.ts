import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentDefaults } from "./agents/definitions.ts";
import type { AgentListEntry } from "./agents/agent-list.ts";
import {
	getAgentListEntries as getAgentListEntriesFromDefinitions,
	getAgentListSignature,
	renderAgentListReminder,
} from "./agents/agent-list.ts";
import {
	loadAgentDefaults as loadAgentDefaultsFromDefinitions,
} from "./agents/definitions.ts";
import { getNoSessionSeedMode } from "./launch/seed-child-session.ts";
import {
	resolveSubagentNoSession,
} from "./launch/policy.ts";
import { resolveSubagentCwd } from "./launch/runtime-paths.ts";
export { resolveSubagentConfigDir } from "./launch/runtime-paths.ts";
export { buildSkillLaunchPlan as buildSkillLaunchPlanForTest } from "./launch/skills.ts";
import {
	resolveEffectiveSessionMode as resolveEffectiveSessionModeFromSessionFiles,
	resolveTaskSessionMode as resolveTaskSessionModeFromSessionFiles,
	type SubagentSessionMode,
} from "./session/session-files.ts";
import type { SubagentParamsInput } from "./types.ts";
import {
	formatElapsed,
	getLaunchedSubagentResult,
	getWatcherSignal,
	launchBackgroundSubagent,
	moduleAbortController,
	shutdownSubagentsForParentExit,
	startWidgetRefresh,
	stopRunningSubagent,
	watchBackgroundSubagent,
	widgetManager,
} from "./runtime/wiring.ts";
export {
	getCompletedSubagentResultForTest,
	getLaunchedSubagentResultForTest,
	getPiInvocationForTest,
	getPiShellPartsForTest,
	getStartedSubagentDetailsForTest,
	getSubagentChildProcessEnvForTest,
	renderSubagentWidgetForTest,
	resetSubagentStateForTest,
	routeDetachedSubagentCompletionForTest,
	setRunningSubagentForTest,
	shutdownSubagentsForTest,
	waitForSubagentForTest,
} from "./runtime/wiring.ts";
import {
	resetSubagentBatchStopRequest,
	stopAfterCurrentSubagentBatch,
} from "./runtime/state.ts";
import { SUBAGENT_TOOL_NAME } from "./tools/tool-names.ts";
import { registerSubagentCommands } from "./tools/commands.ts";
import { registerSubagentMessageRenderers } from "./tools/message-renderers.ts";
import { markInitialPromptLaunchComplete, registerSubagentCoreTools } from "./tools/subagent-tools.ts";
import { registerSubagentsView } from "./tools/subagents-view.ts";

export { markSubagentBatchBlocking as markSubagentBatchBlockingForTest } from "./runtime/state.ts";
export { requestSubagentBatchStop as requestSubagentBatchStopForTest } from "./runtime/state.ts";
export { getSubagentBatchStopMetadata as getSubagentBatchStopMetadataForTest } from "./runtime/state.ts";
export { shouldAwaitSubagentLaunch as shouldAwaitSubagentLaunchForTest } from "./runtime/running-registry.ts";
export { classifyAssistantMessageForMixedBatch as classifyAssistantMessageForMixedBatchForTest } from "./runtime/batch-classifier.ts";
export * from "./testing/test-helpers.ts";

export function loadAgentDefaults(
	agentName: string,
	cwdHint?: string | null,
	baseCwd = process.cwd(),
): AgentDefaults | null {
	return loadAgentDefaultsFromDefinitions(
		agentName,
		cwdHint,
		baseCwd,
		resolveSubagentCwd,
	);
}

function getAgentListEntries(
	baseCwd = process.cwd(),
): AgentListEntry[] {
	return getAgentListEntriesFromDefinitions(baseCwd, resolveTaskSessionMode);
}

function resolveEffectiveSessionMode(
	params: Partial<SubagentParamsInput>,
	agentDefs: AgentDefaults | null,
): SubagentSessionMode {
	return resolveEffectiveSessionModeFromSessionFiles(params, agentDefs);
}

function resolveTaskSessionMode(
	agentDefs: AgentDefaults | null,
): SubagentSessionMode {
	return resolveTaskSessionModeFromSessionFiles(
		agentDefs,
		resolveSubagentNoSession,
		getNoSessionSeedMode,
	);
}

let lastAmbientRosterSignature: string | null = null;
let pendingAmbientRoster: {
	signature: string;
	content: string;
	entries: AgentListEntry[];
	supersedes?: true;
} | null = null;

export default function subagentsExtension(pi: ExtensionAPI) {
	function attachWidgetContext(ctx: ExtensionContext) {
		widgetManager.attachContext(ctx);
	}

	function applySubagentLineage(ctx: ExtensionContext) {
		const parentSession = process.env.PI_SUBAGENT_PARENT_SESSION?.trim();
		if (!parentSession) return;
		const header = ctx.sessionManager.getHeader?.();
		if (!header || header.parentSession) return;
		header.parentSession = parentSession;
	}

	// Capture the UI context early so the widget keeps a stable slot above tasks.
	pi.on("session_start", (event, ctx) => {
		resetSubagentBatchStopRequest();
		applySubagentLineage(ctx);
		attachWidgetContext(ctx);

		if (!shouldRegister(SUBAGENT_TOOL_NAME)) return;

		// Reset the cached signature on every fresh session so module-level state
		// does not leak between sessions. The reload path still uses the cached
		// signature to avoid duplicating the notification within the same session.
		if (event.reason !== "reload") {
			lastAmbientRosterSignature = null;
		}

		const entries = getAgentListEntries(ctx.cwd);
		const signature = getAgentListSignature(entries);
		if (entries.length === 0) {
			if (event.reason === "reload") pendingAmbientRoster = null;
			lastAmbientRosterSignature = null;
			return;
		}

		if (signature === lastAmbientRosterSignature) {
			pendingAmbientRoster = null;
			return;
		}

		pendingAmbientRoster = {
			signature,
			content: renderAgentListReminder(entries),
			entries,
			supersedes: event.reason === "reload" ? true : undefined,
		};
	});

	pi.on("before_agent_start", () => {
		const rosterResult = pendingAmbientRoster
			? {
					message: {
						customType: "subagent_roster",
						content: pendingAmbientRoster.content,
						display: false,
						details: {
							entries: pendingAmbientRoster.entries,
							signature: pendingAmbientRoster.signature,
							...(pendingAmbientRoster.supersedes
								? { supersedes: true }
								: {}),
						},
					},
				}
			: undefined;
		if (pendingAmbientRoster) {
			lastAmbientRosterSignature = pendingAmbientRoster.signature;
			pendingAmbientRoster = null;
		}

		return rosterResult;
	});

	pi.on("input", () => {
		resetSubagentBatchStopRequest();
		return { action: "continue" as const };
	});

	pi.on("turn_start", () => {
		resetSubagentBatchStopRequest();
	});

	pi.on("agent_end", () => {
		resetSubagentBatchStopRequest();
		markInitialPromptLaunchComplete();
	});

	// Clean up on real session shutdown. Pi also emits this event for the
	// coordinator-only turn stop after async launches; that must not kill the
	// children that the stop was created to leave running.
	pi.on("session_shutdown", (_event, ctx) => {
		if (stopAfterCurrentSubagentBatch) return;

		moduleAbortController.abort();
		widgetManager.reset();
		resetSubagentBatchStopRequest();
		shutdownSubagentsForParentExit();
		if (ctx.hasUI) {
			ctx.ui.setWidget("subagent-status", undefined);
		}
	});

	// Tools denied via PI_DENY_TOOLS env var (set by parent agent based on frontmatter)
	const deniedTools = new Set(
		(process.env.PI_DENY_TOOLS ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);

	const shouldRegister = (name: string) => !deniedTools.has(name);

	registerSubagentCoreTools(pi, shouldRegister, {
		loadAgentDefaults: (agentName, cwd) => agentName ? loadAgentDefaults(agentName, undefined, cwd) : null,
		resolveEffectiveSessionMode,
		resolveTaskSessionMode,
		launchBackgroundSubagent,
		watchBackgroundSubagent,
		getWatcherSignal,
		startWidgetRefresh,
		getLaunchedSubagentResult,
	});

	registerSubagentCommands(pi, {
		stopRunningSubagent,
	});

	registerSubagentMessageRenderers(pi, formatElapsed);

	registerSubagentsView(pi, {
		startWidgetRefresh,
		pi,
	});

}
