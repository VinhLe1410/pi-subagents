/**
 * Single source of truth for tool names that pi-subagents itself registers
 * or treats specially.
 */

export const SUBAGENT_TOOL_NAME = "subagent";

/**
 * Tools that launch a subagent run.
 */
export const SUBAGENT_LAUNCH_TOOL_NAMES: ReadonlySet<string> = new Set([
	SUBAGENT_TOOL_NAME,
]);

