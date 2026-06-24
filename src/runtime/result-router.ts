import type {
	CompletedSubagentResult,
} from "../types.ts";

interface ParentMessageSink {
	sendMessage(message: unknown, options: unknown): void;
}

function getResultLabel(result: Pick<CompletedSubagentResult, "name" | "agent">): string {
	return result.agent ? `${result.name} (${result.agent})` : result.name;
}

export function deliverCompletedSubagentResult(
	pi: ParentMessageSink,
	completed: CompletedSubagentResult,
	_formatElapsed: (elapsed: number) => string,
): CompletedSubagentResult {
	if (completed.deliveryState !== "detached" || completed.deliveredTo) {
		return completed;
	}

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
		{ triggerTurn: true, deliverAs: "steer" },
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
