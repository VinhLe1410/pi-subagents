import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	CompletedSubagentResult,
	RunningSubagent,
} from "../types.ts";
import {
	clearSubagentShutdownTimer,
	completedSubagentResults,
	runningSubagents,
} from "./state.ts";
import {
	deliverCompletedSubagentResult,
} from "./result-router.ts";

export interface RunningRegistryRuntime {
	formatElapsed(elapsed: number): string;
	updateWidget(): void;
	waitForSubagentResult(params: { id: string }, signal?: AbortSignal): Promise<unknown>;
	asSubagentToolResult(result: unknown): any;
}

export function findTrackedSubagent(query: string): {
	id?: string;
	running?: RunningSubagent;
	cached?: CompletedSubagentResult;
	error?: string;
} {
	const cachedById = completedSubagentResults.get(query);
	if (cachedById) return { id: cachedById.id, cached: cachedById };
	const runningById = runningSubagents.get(query);
	if (runningById) return { id: runningById.id, running: runningById };

	const exactCachedMatches = [...completedSubagentResults.values()].filter(
		(agent) => agent.name === query,
	);
	if (exactCachedMatches.length === 1) {
		return { id: exactCachedMatches[0].id, cached: exactCachedMatches[0] };
	}
	if (exactCachedMatches.length > 1) {
		return {
			error: `Multiple completed subagents match "${query}". Use the id instead.`,
		};
	}

	const exactRunningMatches = [...runningSubagents.values()].filter(
		(agent) => agent.name === query,
	);
	if (exactRunningMatches.length === 1) {
		return { id: exactRunningMatches[0].id, running: exactRunningMatches[0] };
	}
	if (exactRunningMatches.length > 1) {
		return {
			error: `Multiple running subagents match "${query}". Use the id instead.`,
		};
	}

	const normalizedQuery = query.toLowerCase();
	const ciCachedMatches = [...completedSubagentResults.values()].filter(
		(agent) => agent.name.toLowerCase() === normalizedQuery,
	);
	if (ciCachedMatches.length === 1) {
		return { id: ciCachedMatches[0].id, cached: ciCachedMatches[0] };
	}
	if (ciCachedMatches.length > 1) {
		return {
			error: `Multiple completed subagents match "${query}". Use the id instead.`,
		};
	}

	const ciRunningMatches = [...runningSubagents.values()].filter(
		(agent) => agent.name.toLowerCase() === normalizedQuery,
	);
	if (ciRunningMatches.length === 1) {
		return { id: ciRunningMatches[0].id, running: ciRunningMatches[0] };
	}
	if (ciRunningMatches.length > 1) {
		return {
			error: `Multiple running subagents match "${query}". Use the id instead.`,
		};
	}

	return { error: `No subagent matches "${query}".` };
}

export function stopRunningSubagent(
	running: RunningSubagent,
	closeSurface: (surface: string) => void,
): void {
	clearSubagentShutdownTimer(running);
	running.abortController?.abort();

	// Always kill the child process/surface regardless of abortController.
	// abortController only stops the watcher polling loop; the child would
	// otherwise keep running and deliver stale results via steer.
	if (running.childProcess?.pid) {
		try {
			process.kill(-running.childProcess.pid, "SIGTERM");
		} catch {
			running.childProcess.kill("SIGTERM");
		}
	}
	if (running.surface) {
		try {
			closeSurface(running.surface);
		} catch {}
	}
}

export async function getLaunchedSubagentResult(
	running: RunningSubagent,
	runtime: RunningRegistryRuntime,
	signal?: AbortSignal,
) {
	const result = await runtime.waitForSubagentResult({ id: running.id }, signal);
	clearSubagentShutdownTimer(running);
	runningSubagents.delete(running.id);
	runtime.updateWidget();
	return runtime.asSubagentToolResult(result);
}

export function deliverCompletedSubagentResultViaSteer(
	pi: Pick<ExtensionAPI, "sendMessage">,
	cached: CompletedSubagentResult,
	formatElapsed: (elapsed: number) => string,
): CompletedSubagentResult {
	return deliverCompletedSubagentResult(pi, cached, formatElapsed);
}

