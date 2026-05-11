import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type {
	CompletedSubagentResult,
	JoinParams,
	RunningSubagent,
	SubagentResult,
} from "../types.ts";
import type { WaitJoinRuntime } from "./wait-join.ts";

function getSubagentJoinResultFields(cached: CompletedSubagentResult) {
	return {
		exitCode: cached.exitCode,
		elapsed: cached.elapsed,
		outputTokens: cached.outputTokens,
		...(cached.sessionFile ? { sessionFile: cached.sessionFile } : {}),
	};
}

function getSubagentJoinErrorResult(
	message: string,
	error: string,
	extra: Record<string, unknown> = {},
) {
	return {
		content: [{ type: "text", text: message }],
		details: { error, ...extra },
	};
}

function releaseSubagentJoinOwnership(
	runtime: WaitJoinRuntime,
	running: RunningSubagent,
	ownerId: string,
): void {
	if (runtime.runningSubagents.get(running.id) !== running) return;
	if (running.resultOwner?.kind !== "join") return;
	if (running.resultOwner.ownerId !== ownerId) return;
	running.resultOwner = undefined;
	running.allowSteerDelivery = true;
	running.deliveryState = "detached";
	runtime.updateWidget();
}

function releaseCompletedJoinResultsToSteer(
	runtime: WaitJoinRuntime,
	ids: string[],
	pi?: Pick<ExtensionAPI, "sendMessage">,
): void {
	for (const id of ids) {
		const cached = runtime.completedSubagentResults.get(id);
		if (!cached || cached.deliveredTo) continue;
		cached.deliveryState = "detached";
		if (pi) runtime.deliverCompletedSubagentResultViaSteer(pi, cached);
	}
}

function markJoinedResultsDelivered(runtime: WaitJoinRuntime, ids: string[]): void {
	for (const id of ids) {
		const cached = runtime.completedSubagentResults.get(id);
		if (!cached) continue;
		cached.deliveryState = "joined";
		cached.deliveredTo = "join";
	}
}

function getSubagentJoinSuccessResult(
	ids: string[],
	results: Record<string, ReturnType<typeof getSubagentJoinResultFields>>,
	pendingIds: string[] = [],
	timeout?: number,
) {
	const completedCount = Object.keys(results).length;
	const isPartial = pendingIds.length > 0;
	return {
		content: [
			{
				type: "text",
				text: isPartial
					? `Joined ${completedCount} of ${ids.length} sub-agents before timeout.`
					: `Joined ${ids.length} sub-agent${ids.length === 1 ? "" : "s"}.`,
			},
		],
		details: {
			ids,
			status: isPartial ? ("partial" as const) : ("completed" as const),
			deliveryState: "joined" as const,
			results,
			...(isPartial ? { pendingIds, timeout } : {}),
		},
	};
}

export async function joinSubagentResults(
	params: JoinParams,
	runtime: WaitJoinRuntime,
	signal?: AbortSignal,
	pi?: Pick<ExtensionAPI, "sendMessage">,
) {
	if (
		params.ids.length === 0 ||
		new Set(params.ids).size !== params.ids.length
	) {
		return getSubagentJoinErrorResult(
			"Join requires a non-empty set of unique child ids or names.",
			"invalid_ids",
			{ ids: params.ids },
		);
	}

	const ownerId = `join:${randomUUID()}`;
	const claimedRunning = new Map<string, RunningSubagent>();
	const claimedCached = new Map<string, CompletedSubagentResult>();
	const resolvedIds = new Set<string>();
	for (const id of params.ids) {
		const match = runtime.findTrackedSubagent(id);
		if (match.error || (!match.cached && !match.running) || !match.id) {
			return getSubagentJoinErrorResult(
				match.error ?? `No subagent matches "${id}".`,
				"not_found",
				{ id },
			);
		}
		if (resolvedIds.has(match.id)) {
			return getSubagentJoinErrorResult(
				"Join requires a non-empty set of unique child ids or names.",
				"invalid_ids",
				{ ids: params.ids },
			);
		}
		resolvedIds.add(match.id);

		const cached = match.cached;
		if (cached) {
			if (cached.deliveryState !== "detached" && !cached.deliveredTo) {
				return getSubagentJoinErrorResult(
					`Sub-agent "${cached.name}" is already owned by another synchronization call.`,
					"already_owned",
					{ id: cached.id },
				);
			}
			claimedCached.set(cached.id, cached);
			continue;
		}

		const running = match.running!;
		if (running.resultOwner) {
			return getSubagentJoinErrorResult(
				`Sub-agent "${running.name}" is already owned by another synchronization call.`,
				"already_owned",
				{ id: running.id },
			);
		}
		if (!running.completionPromise) {
			return getSubagentJoinErrorResult(
				`Sub-agent "${running.name}" is missing completion tracking.`,
				"not_found",
				{ id: running.id },
			);
		}
		claimedRunning.set(running.id, running);
	}

	const joinedIds = [...resolvedIds];

	for (const cached of claimedCached.values()) {
		cached.deliveryState = "joined";
	}
	for (const running of claimedRunning.values()) {
		running.resultOwner = { kind: "join", ownerId };
		running.allowSteerDelivery = false;
		running.deliveryState = "joined";
	}
	runtime.updateWidget();

	const results: Record<
		string,
		ReturnType<typeof getSubagentJoinResultFields>
	> = {};
	for (const [id, cached] of claimedCached.entries()) {
		results[id] = getSubagentJoinResultFields(cached);
	}

	const completedIds = new Set(Object.keys(results));
	const pending = new Map(claimedRunning);
	if (pending.size === 0) {
		markJoinedResultsDelivered(runtime, [...completedIds]);
		return getSubagentJoinSuccessResult(joinedIds, results);
	}

	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	let abortCleanup = () => {};
	let timeoutPromise: Promise<{ kind: "timeout" }> | undefined;
	let interruptPromise: Promise<{ kind: "interrupted" }> | undefined;
	try {
		if (params.timeout && params.timeout > 0) {
			timeoutPromise = new Promise((resolve) => {
				timeoutHandle = setTimeout(
					() => resolve({ kind: "timeout" as const }),
					params.timeout! * 1000,
				);
			});
		}
		if (signal) {
			if (signal.aborted) {
				for (const running of pending.values()) {
					releaseSubagentJoinOwnership(runtime, running, ownerId);
				}
				releaseCompletedJoinResultsToSteer(runtime, [...completedIds], pi);
				return getSubagentJoinErrorResult(
					"Joining sub-agents was interrupted.",
					"interrupted",
					{ ids: joinedIds },
				);
			}
			interruptPromise = new Promise((resolve) => {
				const onAbort = () => resolve({ kind: "interrupted" as const });
				signal.addEventListener("abort", onAbort, { once: true });
				abortCleanup = () => signal.removeEventListener("abort", onAbort);
			});
		}

		while (pending.size > 0) {
			const races: Array<
				Promise<
					| { kind: "completed"; id: string; result: SubagentResult }
					| { kind: "timeout" }
					| { kind: "interrupted" }
				>
			> = [...pending.entries()].map(([id, running]) =>
				running.completionPromise!.then((result) => ({
					kind: "completed" as const,
					id,
					result,
				})),
			);
			if (timeoutPromise) races.push(timeoutPromise);
			if (interruptPromise) races.push(interruptPromise);

			const outcome = await Promise.race(races);
			if (outcome.kind === "completed") {
				pending.delete(outcome.id);
				const running = claimedRunning.get(outcome.id)!;
				if (outcome.result.ping) {
					for (const pendingRunning of pending.values()) {
						releaseSubagentJoinOwnership(runtime, pendingRunning, ownerId);
					}
					releaseCompletedJoinResultsToSteer(runtime, [...completedIds], pi);
					return {
						content: [
							{
								type: "text",
								text:
									`Sub-agent "${running.name}" requested help and exited. ` +
									`Resume it with subagent_resume using sessionFile ${outcome.result.sessionFile ?? "(missing)"}.`,
							},
						],
						details: {
							ids: joinedIds,
							id: running.id,
							status: "pinged" as const,
							deliveryState: "joined" as const,
							pendingIds: [...pending.keys()],
							sessionFile: outcome.result.sessionFile,
							message: outcome.result.ping.message,
							results,
						},
					};
				}
				const completed =
					runtime.completedSubagentResults.get(outcome.id) ??
					runtime.cacheCompletedSubagentResult(running, outcome.result);
				if (
					completed.deliveredTo &&
					completed.deliveredTo !== "join" &&
					completed.deliveredTo !== "steer"
				) {
					for (const pendingRunning of pending.values()) {
						releaseSubagentJoinOwnership(runtime, pendingRunning, ownerId);
					}
					releaseCompletedJoinResultsToSteer(runtime, [...completedIds], pi);
					return getSubagentJoinErrorResult(
						`Sub-agent result for "${outcome.id}" was already delivered via ${completed.deliveredTo}.`,
						"already_delivered",
						{ id: outcome.id },
					);
				}
				completed.deliveryState = "joined";
				results[outcome.id] = getSubagentJoinResultFields(completed);
				completedIds.add(outcome.id);
				continue;
			}

			for (const pendingRunning of pending.values()) {
				releaseSubagentJoinOwnership(runtime, pendingRunning, ownerId);
			}
			if (outcome.kind === "interrupted") {
				releaseCompletedJoinResultsToSteer(runtime, [...completedIds], pi);
				return getSubagentJoinErrorResult(
					"Joining sub-agents was interrupted.",
					"interrupted",
					{ ids: joinedIds },
				);
			}
			if (
				params.onTimeout === "return_partial" ||
				params.onTimeout === "detach" ||
				params.onTimeout === "return"
			) {
				markJoinedResultsDelivered(runtime, [...completedIds]);
				return getSubagentJoinSuccessResult(
					joinedIds,
					results,
					[...pending.keys()],
					params.timeout,
				);
			}
			releaseCompletedJoinResultsToSteer(runtime, [...completedIds], pi);
			return getSubagentJoinErrorResult(
				"Timed out joining sub-agents.",
				"timeout",
				{ ids: joinedIds, timeout: params.timeout },
			);
		}

		markJoinedResultsDelivered(runtime, [...completedIds]);
		return getSubagentJoinSuccessResult(joinedIds, results);
	} finally {
		if (timeoutHandle) clearTimeout(timeoutHandle);
		abortCleanup();
	}
}
