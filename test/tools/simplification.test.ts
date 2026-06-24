import { setTimeout as delay } from "node:timers/promises";
import { assert, describe, it } from "../support/index.ts";
import { renderAgentListReminder } from "../../src/agents/agent-list.ts";
import { waitForSubagentResult } from "../../src/runtime/wait-result.ts";
import { registerSubagentCoreTools } from "../../src/tools/subagent-tools.ts";
import type { CompletedSubagentResult, RunningSubagent, SubagentResult } from "../../src/types.ts";

function makeRunning(overrides: Partial<RunningSubagent> = {}): RunningSubagent {
	return {
		id: "child-1",
		name: "code-scout",
		task: "Scout code",
		title: "Code scout",
		agent: "scout",
		executionState: "running",
		deliveryState: "detached",
		parentClosePolicy: "terminate",
		startTime: Date.now(),
		sessionFile: "/tmp/child-session.jsonl",
		...overrides,
	};
}

function makeCompleted(overrides: Partial<CompletedSubagentResult> = {}): CompletedSubagentResult {
	return {
		id: "child-1",
		name: "code-scout",
		task: "Scout code",
		summary: "Done",
		sessionFile: "/tmp/child-session.jsonl",
		exitCode: 0,
		elapsed: 12,
		agent: "scout",
		status: "completed",
		deliveryState: "detached",
		parentClosePolicy: "terminate",
		deliveredTo: null,
		...overrides,
	};
}

describe("simplified subagent surface", () => {
	it("registers only the subagent parent tool", () => {
		const names: string[] = [];
		const pi = {
			registerTool(tool: { name: string }) {
				names.push(tool.name);
			},
		} as any;

		registerSubagentCoreTools(pi, () => true, {} as any);

		assert.deepEqual(names, ["subagent"]);
	});

	it("renders roster entries as name, description, and one context rule", () => {
		const reminder = renderAgentListReminder([
			{ name: "code-scout", source: "project", description: "Inspect code." },
		]);

		assert.match(reminder, /Subagent roster:/);
		assert.match(reminder, /`code-scout`: Inspect code\./);
		assert.doesNotMatch(reminder, /subagent-rules|tool_return|runs_as|model|session-mode|auto-exit|async/);
	});

	it("validates every batch child before launching any child", async () => {
		let launchCount = 0;
		let execute: ((toolCallId: string, params: unknown, signal: AbortSignal, onUpdate: unknown, ctx: unknown) => Promise<unknown>) | undefined;
		const pi = {
			getThinkingLevel: () => "medium",
			registerTool(tool: { execute: typeof execute }) {
				execute = tool.execute;
			},
		} as any;
		const runtime = {
			loadAgentDefaults: (agentName: string | undefined) => agentName === "scout" ? {} : null,
			launchBackgroundSubagent: async () => {
				launchCount++;
				return makeRunning();
			},
			watchBackgroundSubagent: async (): Promise<SubagentResult> => ({
				name: "code-scout",
				task: "Scout code",
				summary: "Done",
				exitCode: 0,
				elapsed: 1,
			}),
			getWatcherSignal: (_running: RunningSubagent, controller: AbortController) => controller.signal,
			startWidgetRefresh: () => {},
			getLaunchedSubagentResult: async () => ({ content: [{ type: "text", text: "Done" }] }),
		} as any;
		registerSubagentCoreTools(pi, () => true, runtime);

		await assert.rejects(
			execute!("tool-1", {
				children: [
					{ name: "valid-one", title: "Valid one", task: "Do work", agent: "scout" },
					{ name: "invalid-two", title: "Invalid two", task: "Do work", agent: "missing" },
				],
			}, new AbortController().signal, undefined, {
				cwd: process.cwd(),
				sessionManager: { getSessionFile: () => null, getSessionId: () => "session" },
			} as any),
			/agent "missing" was not found/,
		);
		assert.equal(launchCount, 0);
	});

	it("labels awaited results and keeps session paths out of visible text", async () => {
		const completed = makeCompleted({ summary: "Finished review." });
		const result = await waitForSubagentResult(
			{ id: completed.id },
			{
				findTrackedSubagent: () => ({ id: completed.id, cached: completed }),
				runningSubagents: new Map(),
				completedSubagentResults: new Map([[completed.id, completed]]),
				cacheCompletedSubagentResult: () => completed,
				stopRunningSubagent: () => {},
				updateWidget: () => {},
			} as any,
		);

		const text = (result as { content: Array<{ text: string }> }).content[0].text;
		assert.equal(text, "code-scout (scout):\nFinished review.");
		assert.doesNotMatch(text, /child-session\.jsonl/);
		assert.equal((result as { details: { sessionFile?: string } }).details.sessionFile, "/tmp/child-session.jsonl");
	});

	it("returns timeout as a normal labeled failure result", async () => {
		const running = makeRunning({
			completionPromise: delay(50).then(() => ({
				name: "code-scout",
				task: "Scout code",
				summary: "Late",
				exitCode: 0,
				elapsed: 50,
			})),
		});
		let stopped = false;
		const result = await waitForSubagentResult(
			{ id: running.id, timeout: 0.001 },
			{
				findTrackedSubagent: () => ({ id: running.id, running }),
				runningSubagents: new Map([[running.id, running]]),
				completedSubagentResults: new Map(),
				cacheCompletedSubagentResult: () => makeCompleted(),
				stopRunningSubagent: () => { stopped = true; },
				updateWidget: () => {},
			} as any,
		);

		assert.equal(stopped, true);
		const timeoutResult = result as unknown as { details: { error: string; status: string }; content: Array<{ text: string }> };
		assert.equal(timeoutResult.details.error, "timeout");
		assert.equal(timeoutResult.content[0].text, "code-scout (scout):\nTimed out after 0.001 seconds.");
	});
});
