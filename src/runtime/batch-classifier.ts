type AssistantMessageLike = {
	role?: string;
	content?: unknown;
};

type AgentDefaultsLoader = (
	agent: string | undefined,
	cwd: string | undefined,
) => unknown;

/**
 * Subagent launches are always awaited now, so mixed async batch classification
 * is a compatibility no-op kept only for older test-helper exports.
 */
export function classifyAssistantMessageForMixedBatch(
	_message: AssistantMessageLike,
	_loadAgentDefaults: AgentDefaultsLoader,
): void {}
