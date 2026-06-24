import { randomUUID } from "node:crypto";
import type {
	CompletedSubagentResult,
	RunningSubagent,
	SubagentResult,
	WaitParams,
} from "../types.ts";
import type { WaitRuntime } from "./wait.ts";

function getResultLabel(result: Pick<CompletedSubagentResult, "name" | "agent">): string {
	return result.agent ? `${result.name} (${result.agent})` : result.name;
}

function getSubagentWaitSuccessResult(cached: CompletedSubagentResult) {
	const text = `${getResultLabel(cached)}:\n${cached.summary}`;
	return {
		content: [{ type: "text", text }],
		details: {
			id: cached.id,
			name: cached.name,
			agent: cached.agent,
			status: cached.status,
			parentClosePolicy: cached.parentClosePolicy,
			deliveryState: "awaited" as const,
			autoExit: cached.autoExit,
			exitCode: cached.exitCode,
			elapsed: cached.elapsed,
			outputTokens: cached.outputTokens,
			summary: cached.summary,
			sessionFile: cached.sessionFile,
			...(cached.errorMessage
				? { errorMessage: cached.errorMessage }
				: {}),
		},
	};
}

function getSubagentWaitErrorResult(
	message: string,
	error: string,
	extra: Record<string, unknown> = {},
) {
	return {
		content: [{ type: "text", text: message }],
		details: { error, ...extra },
	};
}

function releaseSubagentWaitOwnership(
	runtime: WaitRuntime,
	running: RunningSubagent,
	ownerId: string,
): void {
	if (runtime.runningSubagents.get(running.id) !== running) return;
	if (running.resultOwner?.kind !== "wait") return;
	if (running.resultOwner.ownerId !== ownerId) return;
	running.resultOwner = undefined;
	running.allowSteerDelivery = true;
	running.deliveryState = "detached";
	runtime.updateWidget();
}

export async function waitForSubagentResult(
	params: WaitParams,
	runtime: WaitRuntime,
	signal?: AbortSignal,
) {
	const match = runtime.findTrackedSubagent(params.id);
	if (match.error || (!match.cached && !match.running)) {
		return getSubagentWaitErrorResult(
			match.error ?? `No subagent matches "${params.id}".`,
			"not_found",
			{ id: params.id },
		);
	}

	const cached = match.cached;
	if (cached) {
		if (cached.deliveryState !== "detached" && !cached.deliveredTo) {
			return getSubagentWaitErrorResult(
				`Sub-agent "${cached.name}" is already owned by another synchronization call.`,
				"already_owned",
				{ id: cached.id },
			);
		}
		cached.deliveryState = "awaited";
		cached.deliveredTo = "wait";
		return getSubagentWaitSuccessResult(cached);
	}

	const running = match.running!;
	if (running.resultOwner) {
		return getSubagentWaitErrorResult(
			`Sub-agent "${running.name}" is already owned by another synchronization call.`,
			"already_owned",
			{ id: running.id },
		);
	}
	if (!running.completionPromise) {
		return getSubagentWaitErrorResult(
			`Sub-agent "${running.name}" is missing completion tracking.`,
			"not_found",
			{ id: running.id },
		);
	}

	const ownerId = `wait:${randomUUID()}`;
	running.resultOwner = { kind: "wait", ownerId };
	running.allowSteerDelivery = false;
	running.deliveryState = "awaited";
	runtime.updateWidget();

	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	let abortCleanup = () => {};
	try {
		const completionPromise = running.completionPromise.then((result) => ({
			kind: "completed" as const,
			result,
		}));
		const races: Array<
			Promise<
				| { kind: "completed"; result: SubagentResult }
				| { kind: "timeout" }
				| { kind: "interrupted" }
			>
		> = [completionPromise];

		if (params.timeout && params.timeout > 0) {
			races.push(
				new Promise((resolve) => {
					timeoutHandle = setTimeout(
						() => resolve({ kind: "timeout" as const }),
						params.timeout! * 1000,
					);
				}),
			);
		}

		if (signal) {
			if (signal.aborted) {
				runtime.stopRunningSubagent(running);
				runtime.runningSubagents.delete(running.id);
				runtime.updateWidget();
				return getSubagentWaitErrorResult(
					`${running.agent ? `${running.name} (${running.agent})` : running.name}:\nCancelled by parent.`,
					"interrupted",
					{ id: running.id, status: "cancelled" },
				);
			}
			races.push(
				new Promise((resolve) => {
					const onAbort = () => resolve({ kind: "interrupted" as const });
					signal.addEventListener("abort", onAbort, { once: true });
					abortCleanup = () => signal.removeEventListener("abort", onAbort);
				}),
			);
		}

		const outcome = await Promise.race(races);
		if (outcome.kind === "completed") {
			const completed =
				runtime.completedSubagentResults.get(running.id) ??
				runtime.cacheCompletedSubagentResult(running, outcome.result);
			if (
				completed.deliveredTo &&
				completed.deliveredTo !== "wait" &&
				completed.deliveredTo !== "steer"
			) {
				return getSubagentWaitErrorResult(
					`Sub-agent result for "${running.id}" was already delivered via ${completed.deliveredTo}.`,
					"already_delivered",
					{ id: running.id },
				);
			}
			completed.deliveryState = "awaited";
			completed.deliveredTo = "wait";
			return getSubagentWaitSuccessResult(completed);
		}

		releaseSubagentWaitOwnership(runtime, running, ownerId);
		if (outcome.kind === "interrupted") {
			runtime.stopRunningSubagent(running);
			runtime.runningSubagents.delete(running.id);
			runtime.updateWidget();
			return getSubagentWaitErrorResult(
				`${running.agent ? `${running.name} (${running.agent})` : running.name}:\nCancelled by parent.`,
				"interrupted",
				{ id: running.id, status: "cancelled" },
			);
		}
		runtime.stopRunningSubagent(running);
		runtime.runningSubagents.delete(running.id);
		runtime.updateWidget();
		return getSubagentWaitErrorResult(
			`${running.agent ? `${running.name} (${running.agent})` : running.name}:\nTimed out after ${params.timeout} seconds.`,
			"timeout",
			{ id: running.id, timeout: params.timeout, status: "failed" },
		);
	} finally {
		if (timeoutHandle) clearTimeout(timeoutHandle);
		abortCleanup();
	}
}
