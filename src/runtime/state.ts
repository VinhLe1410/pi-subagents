import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { getSubagentTerminalStopReason } from "../session/session.ts";
import type {
	CompletedSubagentResult,
	RunningSubagent,
	SubagentCompletionStatus,
	SubagentResult,
} from "../types.ts";
import { SubagentWidgetManager } from "./widget.ts";

export const runningSubagents = new Map<string, RunningSubagent>();
export const completedSubagentResults = new Map<string, CompletedSubagentResult>();

function getSubagentCompletionStatus(
	result: SubagentResult,
	_running?: Pick<RunningSubagent, "autoExit">,
): SubagentCompletionStatus {
	if (result.error === "cancelled") return "cancelled";
	// Provider/network errors may set errorMessage with exitCode 0
	// (Pi exits cleanly even when model calls fail after retry exhaustion).
	if (result.errorMessage) return "failed";
	if (getSubagentTerminalStopReason(result.summary)) return "failed";
	if (result.exitCode === 0) return "completed";
	return "failed";
}

export function buildCompletedSubagentResult(
	running: RunningSubagent,
	result: SubagentResult,
): CompletedSubagentResult {
	return {
		...result,
		id: running.id,
		agent: running.agent,
		status: getSubagentCompletionStatus(result, running),
		deliveryState: running.deliveryState,
		parentClosePolicy: running.parentClosePolicy,
		autoExit: running.autoExit,
		deliveredTo: null,
	};
}

export function cacheCompletedSubagentResult(
	running: RunningSubagent,
	result: SubagentResult,
): CompletedSubagentResult {
	const cached = buildCompletedSubagentResult(running, result);
	completedSubagentResults.set(running.id, cached);
	return cached;
}

export function clearSubagentShutdownTimer(running: RunningSubagent): void {
	if (!running.shutdownTimer) return;
	clearTimeout(running.shutdownTimer);
	running.shutdownTimer = undefined;
}

export const widgetManager = new SubagentWidgetManager(() =>
	runningSubagents.values(),
);

const WIDGET_MANAGER_KEY = Symbol.for("pi-subagents/widget-manager");
const MODULE_ABORT_KEY = Symbol.for("pi-subagents/poll-abort-controller");

function initializeModuleReloadState(): AbortController {
	const previousWidgetManager = (globalThis as Record<PropertyKey, unknown>)[
		WIDGET_MANAGER_KEY
	] as SubagentWidgetManager | undefined;
	previousWidgetManager?.reset();

	const previousAbortController = (globalThis as Record<PropertyKey, unknown>)[
		MODULE_ABORT_KEY
	] as AbortController | undefined;
	previousAbortController?.abort();

	const controller = new AbortController();
	(globalThis as Record<PropertyKey, unknown>)[WIDGET_MANAGER_KEY] =
		widgetManager;
	(globalThis as Record<PropertyKey, unknown>)[MODULE_ABORT_KEY] = controller;
	return controller;
}

export type SubagentToolResult = AgentToolResult<unknown> & { terminate?: true };

export function asSubagentToolResult(result: unknown): SubagentToolResult {
	return result as SubagentToolResult;
}

export const moduleAbortController = initializeModuleReloadState();
export function resetSubagentBatchStopRequest(): void {}

export function getWatcherSignal(
	_running: RunningSubagent,
	watcherAbort: AbortController,
): AbortSignal {
	return watcherAbort.signal;
}

