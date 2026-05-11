import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type {
	CompletedSubagentResult,
	RunningSubagent,
	SubagentResult,
} from "../types.ts";

interface TrackedSubagentMatch {
	id?: string;
	running?: RunningSubagent;
	cached?: CompletedSubagentResult;
	error?: string;
}

export interface WaitJoinRuntime {
	runningSubagents: Map<string, RunningSubagent>;
	completedSubagentResults: Map<string, CompletedSubagentResult>;
	findTrackedSubagent(query: string): TrackedSubagentMatch;
	cacheCompletedSubagentResult(
		running: RunningSubagent,
		result: SubagentResult,
	): CompletedSubagentResult;
	updateWidget(): void;
	deliverCompletedSubagentResultViaSteer(
		pi: Pick<ExtensionAPI, "sendMessage">,
		cached: CompletedSubagentResult,
	): CompletedSubagentResult;
}

export { joinSubagentResults } from "./join-result.ts";
export { waitForSubagentResult } from "./wait-result.ts";
