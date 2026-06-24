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

/**
 * Parent-side tools allowed when PI_ORCHESTRATOR_MODE=1 turns the parent
 * into a delegation-only orchestrator.
 */
export const ORCHESTRATOR_ALLOWED_TOOL_NAMES: ReadonlySet<string> = new Set([
	SUBAGENT_TOOL_NAME,
]);
