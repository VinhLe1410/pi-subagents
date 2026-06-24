import type {
	CompletedSubagentResult,
	RunningSubagent,
	SubagentResult,
} from "../types.ts";
import {
	buildCompletedSubagentResult,
	cacheCompletedSubagentResult,
	clearSubagentShutdownTimer,
	runningSubagents,
	stopAfterCurrentSubagentBatch,
} from "./state.ts";

interface ParentMessageSink {
	sendMessage(message: unknown, options: unknown): void;
}

export interface RouteSubagentOutcomeOptions {
	pi: ParentMessageSink;
	running: RunningSubagent;
	result: SubagentResult;
	formatElapsed(elapsed: number): string;
	updateWidget(): void;
}

interface RoutedCompletionOutcome {
	kind: "completion";
	completed: CompletedSubagentResult;
}

export type RoutedSubagentOutcome = RoutedCompletionOutcome;

function getResultLabel(result: Pick<CompletedSubagentResult, "name" | "agent">): string {
	return result.agent ? `${result.name} (${result.agent})` : result.name;
}

export function routeSubagentOutcome(
	options: RouteSubagentOutcomeOptions,
): RoutedSubagentOutcome {
	const { pi, running, result, formatElapsed, updateWidget } = options;
	clearSubagentShutdownTimer(running);
	const completed = running.allowSteerDelivery === false && !running.resultOwner
		? buildCompletedSubagentResult(running, result)
		: cacheCompletedSubagentResult(running, result);
	runningSubagents.delete(running.id);
	updateWidget();
	if (running.allowSteerDelivery === false) {
		return { kind: "completion", completed };
	}
	return {
		kind: "completion",
		completed: deliverCompletedSubagentResult(pi, completed, formatElapsed),
	};
}

export function deliverCompletedSubagentResult(
	pi: ParentMessageSink,
	completed: CompletedSubagentResult,
	_formatElapsed: (elapsed: number) => string,
): CompletedSubagentResult {
	if (completed.deliveryState !== "detached" || completed.deliveredTo) {
		return completed;
	}

	const deliverAs = stopAfterCurrentSubagentBatch ? "nextTurn" : "steer";
	completed.deliveredTo = "steer";
	pi.sendMessage(
		{
			customType: "subagent_result",
			content: getCompletedSubagentContent(completed),
			display: true,
			details: {
				id: completed.id,
				name: completed.name,
				task: completed.task,
				agent: completed.agent,
				status: completed.status,
				deliveryState: completed.deliveryState,
				parentClosePolicy: completed.parentClosePolicy,
				exitCode: completed.exitCode,
				elapsed: completed.elapsed,
				outputTokens: completed.outputTokens,
				sessionFile: completed.sessionFile,
				summary: completed.summary,
				...(completed.errorMessage ? { errorMessage: completed.errorMessage } : {}),
			},
		},
		{ triggerTurn: true, deliverAs },
	);
	return completed;
}

function getCompletedSubagentContent(
	completed: CompletedSubagentResult,
): string {
	if (completed.errorMessage) {
		return `${getResultLabel(completed)}:\nError: ${completed.errorMessage}`;
	}
	return `${getResultLabel(completed)}:\n${completed.summary}`;
}
