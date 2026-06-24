import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RunningSubagent } from "../types.ts";

export interface SubagentCommandRuntime {
	stopRunningSubagent(running: RunningSubagent): void;
}

export function registerSubagentCommands(
	pi: ExtensionAPI,
	runtime: SubagentCommandRuntime,
): void {
	// No subagent commands are registered in the simplified blocking runtime.
}
