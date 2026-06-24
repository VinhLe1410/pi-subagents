import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { launchBackgroundSubagent as launchBackgroundSubagentWithRuntime, type BackgroundLaunchRuntime } from "../launch/background.ts";
import { cleanupNoSessionSessionFile } from "../launch/prep.ts";
import { watchBackgroundSubagent as watchBackgroundSubagentWithRuntime, type BackgroundWatchRuntime } from "./background-watch.ts";
import { shutdownSubagentsForParentExit as shutdownSubagentsForParentExitWithRuntime, terminateBackgroundChildProcess, type ShutdownRuntime, type ShutdownSubagentsOptions } from "./shutdown.ts";
import type { CompletedSubagentResult, RunningSubagent, SubagentParamsInput, WaitParams } from "../types.ts";
import type { SubagentLaunchContext } from "../launch/prep.ts";
import { getLaunchedSubagentResult as getLaunchedSubagentResultWithRuntime, stopRunningSubagent as stopRunningSubagentWithDeps, deliverCompletedSubagentResultViaSteer as deliverCompletedSubagentResultViaSteerWithDeps, findTrackedSubagent } from "./running-registry.ts";
import { waitForSubagentResult as waitForSubagentResultWithRuntime, type WaitRuntime } from "./wait.ts";
import { asSubagentToolResult, cacheCompletedSubagentResult, completedSubagentResults, moduleAbortController, runningSubagents, widgetManager } from "./state.ts";

export { getWatcherSignal, moduleAbortController, widgetManager } from "./state.ts";

const noopCloseSurface = (_surface: string) => {};

export function formatElapsed(seconds: number): string {
	const s = Math.round(seconds);
	const m = Math.floor(s / 60);
	return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function updateWidget() {
	widgetManager.update();
}

export function startWidgetRefresh() {
	widgetManager.startRefresh();
}


export function stopRunningSubagent(running: RunningSubagent): void {
	stopRunningSubagentWithDeps(running, noopCloseSurface);
	updateWidget();
}

export async function getLaunchedSubagentResult(
	running: RunningSubagent,
	signal?: AbortSignal,
) {
	return getLaunchedSubagentResultWithRuntime(
		running,
		{ formatElapsed, updateWidget, waitForSubagentResult, asSubagentToolResult },
		signal,
	);
}


function deliverCompletedSubagentResultViaSteer(
	pi: Pick<ExtensionAPI, "sendMessage">,
	cached: CompletedSubagentResult,
): CompletedSubagentResult {
	return deliverCompletedSubagentResultViaSteerWithDeps(pi, cached, formatElapsed);
}


function getWaitRuntime(): WaitRuntime {
	return {
		runningSubagents,
		completedSubagentResults,
		findTrackedSubagent,
		cacheCompletedSubagentResult,
		updateWidget,
		deliverCompletedSubagentResultViaSteer,
		stopRunningSubagent: (running) => stopRunningSubagentWithDeps(running, noopCloseSurface),
		closeSurface: noopCloseSurface,
	};
}

async function waitForSubagentResult(params: WaitParams, signal?: AbortSignal) {
	return waitForSubagentResultWithRuntime(params, getWaitRuntime(), signal);
}


function getBackgroundLaunchRuntime(): BackgroundLaunchRuntime {
	return { getContextWindow: (modelRef) => widgetManager.resolveModelContextWindow(modelRef) };
}

export async function launchBackgroundSubagent(
	params: SubagentParamsInput,
	ctx: SubagentLaunchContext,
): Promise<RunningSubagent> {
	const running = await launchBackgroundSubagentWithRuntime(params, ctx, getBackgroundLaunchRuntime());
	runningSubagents.set(running.id, running);
	return running;
}

function getBackgroundWatchRuntime(): BackgroundWatchRuntime {
	return { cleanupNoSessionSessionFile, terminateBackgroundChildProcess };
}

export async function watchBackgroundSubagent(
	running: RunningSubagent,
	signal?: AbortSignal,
	timeoutMs?: number,
) {
	return watchBackgroundSubagentWithRuntime(running, getBackgroundWatchRuntime(), signal ?? moduleAbortController.signal, timeoutMs);
}

function getShutdownRuntime(): ShutdownRuntime {
	return { runningSubagents, completedSubagentResults, parentCloseEscalationMs: 5000, updateWidget };
}

export function shutdownSubagentsForParentExit(options?: ShutdownSubagentsOptions) {
	return shutdownSubagentsForParentExitWithRuntime(getShutdownRuntime(), options);
}

