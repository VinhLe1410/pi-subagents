import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { launchBackgroundSubagent as launchBackgroundSubagentWithRuntime, type BackgroundLaunchRuntime } from "../launch/background.ts";
import { cleanupNoSessionSessionFile } from "../launch/prep.ts";
import { watchBackgroundSubagent as watchBackgroundSubagentWithRuntime, type BackgroundWatchRuntime } from "./background-watch.ts";
import { getPiInvocation, getPiShellParts, getSubagentChildProcessEnv } from "../launch/child-command.ts";
import { shutdownSubagentsForParentExit as shutdownSubagentsForParentExitWithRuntime, terminateBackgroundChildProcess, type ShutdownRuntime, type ShutdownSubagentsOptions } from "./shutdown.ts";
import type { CompletedSubagentResult, RunningSubagent, SubagentParamsInput, SubagentResult, WaitParams } from "../types.ts";
import type { SubagentLaunchContext } from "../launch/prep.ts";
import { getStartedSubagentDetails, getLaunchedSubagentResult as getLaunchedSubagentResultWithRuntime, routeDetachedSubagentCompletion as routeDetachedSubagentCompletionWithDeps, stopRunningSubagent as stopRunningSubagentWithDeps, wireSubagentSteerBack as wireSubagentSteerBackWithDeps, deliverCompletedSubagentResultViaSteer as deliverCompletedSubagentResultViaSteerWithDeps, findTrackedSubagent } from "./running-registry.ts";
import { waitForSubagentResult as waitForSubagentResultWithRuntime, type WaitRuntime } from "./wait.ts";
import { asSubagentToolResult, cacheCompletedSubagentResult, completedSubagentResults, moduleAbortController, resetRuntimeStateForTest, runningSubagents, widgetManager } from "./state.ts";

export { getWatcherSignal, moduleAbortController, runningSubagents, widgetManager } from "./state.ts";

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

export function getPiInvocationForTest(args: string[]) {
	return getPiInvocation(args);
}

export function getPiShellPartsForTest(args: string[]) {
	return getPiShellParts(args);
}

export function getSubagentChildProcessEnvForTest(
	invocation: { command: string; args: string[] },
	envVars: Record<string, string>,
) {
	return getSubagentChildProcessEnv(invocation, envVars);
}

export function getCompletedSubagentResultForTest(id: string) {
	return completedSubagentResults.get(id);
}

export function resetSubagentStateForTest() {
	resetRuntimeStateForTest(() => {});
}

export function setRunningSubagentForTest(running: RunningSubagent) {
	runningSubagents.set(running.id, running);
}

export function renderSubagentWidgetForTest() {
	return widgetManager.renderForTest();
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

export function getStartedSubagentDetailsForTest(running: RunningSubagent) {
	return getStartedSubagentDetails(running);
}

export function getLaunchedSubagentResultForTest(
	running: RunningSubagent,
	signal?: AbortSignal,
) {
	return getLaunchedSubagentResult(running, signal);
}

export function routeDetachedSubagentCompletionForTest(
	pi: Pick<ExtensionAPI, "sendMessage">,
	running: RunningSubagent,
	result: SubagentResult,
): CompletedSubagentResult {
	return routeDetachedSubagentCompletion(pi as ExtensionAPI, running, result);
}

function deliverCompletedSubagentResultViaSteer(
	pi: Pick<ExtensionAPI, "sendMessage">,
	cached: CompletedSubagentResult,
): CompletedSubagentResult {
	return deliverCompletedSubagentResultViaSteerWithDeps(pi, cached, formatElapsed);
}

function routeDetachedSubagentCompletion(
	pi: ExtensionAPI,
	running: RunningSubagent,
	result: SubagentResult,
): CompletedSubagentResult {
	return routeDetachedSubagentCompletionWithDeps(pi, running, result, formatElapsed, updateWidget);
}

export function wireSubagentSteerBack(
	pi: ExtensionAPI,
	running: RunningSubagent,
	watchPromise: Promise<SubagentResult>,
): void {
	wireSubagentSteerBackWithDeps(pi, running, watchPromise, formatElapsed, updateWidget);
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

export function waitForSubagentForTest(params: WaitParams, signal?: AbortSignal) {
	return waitForSubagentResult(params, signal);
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

export function shutdownSubagentsForTest(options?: ShutdownSubagentsOptions) {
	return shutdownSubagentsForParentExit(options);
}
