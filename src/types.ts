import type { ChildProcess } from "node:child_process";

export type ParentClosePolicy = "terminate" | "continue";
type DeliveryState = "detached" | "awaited";
type CompletedDelivery = "steer" | "wait";
export type SubagentCompletionStatus = "completed" | "failed" | "cancelled";
export type ParentShutdownAction = "terminate" | "continue";

export interface SubagentParamsInput {
	name: string;
	task: string;
	title: string;
	agent: string;
}

export interface WaitParams {
	id: string;
	timeout?: number;
}

export interface SubagentResult {
	name: string;
	task: string;
	summary: string;
	sessionFile?: string;
	exitCode: number;
	elapsed: number;
	outputTokens?: number;
	error?: string;
	errorMessage?: string;
}

export interface CompletedSubagentResult extends SubagentResult {
	id: string;
	agent?: string;
	status: SubagentCompletionStatus;
	deliveryState: DeliveryState;
	parentClosePolicy: ParentClosePolicy;
	autoExit?: boolean;
	deliveredTo: CompletedDelivery | null;
}

export interface RunningSubagent {
	id: string;
	name: string;
	task: string;
	title?: string;
	agent?: string;
	executionState: "starting" | "running";
	deliveryState: DeliveryState;
	parentClosePolicy: ParentClosePolicy;
	autoExit?: boolean;
	noSession?: boolean;
	resultOwner?: { kind: CompletedDelivery; ownerId: string };
	completionPromise?: Promise<SubagentResult>;
	surface?: string;
	childProcess?: ChildProcess;
	stderrTail?: string;
	stdoutTail?: string;
	startTime: number;
	sessionFile: string;
	entries?: number;
	bytes?: number;
	launchEntryCount?: number;
	messageCount?: number;
	toolUses?: number;
	totalTokens?: number;
	/** Snapshot of the latest assistant message's usage total, for context-window ratio display. */
	contextTokens?: number;
	modelContextWindow?: number;
	/** Resolved provider/model:thinking ref for this child, for display in the widget/overlay. */
	modelRef?: string;
	contextLabel?: string;
	activity?: string;
	taskPreview?: string;
	lastAssistantText?: string;
	lastSessionSize?: number;
	pendingToolCount?: number;
	abortController?: AbortController;
	allowSteerDelivery?: boolean;
	shutdownTimer?: ReturnType<typeof setTimeout>;
	doneSentinelFile?: string;
}

export interface StartedSubagentToolDetails {
	id?: string;
	name?: string;
	title?: string;
	status?: string;
	error?: string;
	deliveryState?: string;
	parentClosePolicy?: string;
	autoExit?: boolean;
}

interface ResumeToolDetails extends StartedSubagentToolDetails {
	sessionFile?: string;
}

export interface SessionUsage {
	totalTokens?: number;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

export interface SessionContentBlock {
	type?: string;
	id?: string;
	name?: string;
	text?: string;
}

export interface SessionMessageLike {
	role?: string;
	content?: SessionContentBlock[];
	usage?: SessionUsage;
	stopReason?: string;
	errorMessage?: string;
	toolCallId?: string;
	provider?: string;
	model?: string;
}

export interface SessionEntryLike {
	type?: string;
	message?: SessionMessageLike;
}

export interface SubagentResultMessageDetails {
	name?: string;
	agent?: string;
	exitCode?: number;
	elapsed?: number;
	sessionFile?: string;
	outputTokens?: number;
	error?: string;
	errorMessage?: string;
}

export interface WidgetThemeLike {
	fg(tone: string, text: string): string;
	bold(text: string): string;
}

export interface WidgetTuiLike {
	terminal?: {
		columns?: number;
	};
}
