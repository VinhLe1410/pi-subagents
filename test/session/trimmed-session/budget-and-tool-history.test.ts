import {
	assert,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
	tmpdir,
	join,
	after,
	before,
	describe,
	it,
	writeTrimmedForkSession,
	assertNeutralizedToolMetadata,
	createMinimalSession,
} from "./support.ts";

describe("writeTrimmedForkSession", () => {
	let tmpDir: string;

	before(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "trimmed-session-test-"));
	});

	after(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("keeps all entries when the session fits within budget", () => {
		const sourcePath = createMinimalSession(tmpDir);
		const childPath = join(tmpDir, "child-1.jsonl");

		writeTrimmedForkSession(sourcePath, childPath, {
			childContextWindow: 100_000,
			reserveTokens: 10_000,
		});

		const written = readFileSync(childPath, "utf-8");
		const lines = written.split("\n").filter((l) => l.trim());

		// Should have a session header + 2 messages = 3 lines
		assert.equal(lines.length, 3, "Should keep header + 2 messages");

		// Header should reference parent session
		const header = JSON.parse(lines[0]);
		assert.equal(header.type, "session");
		assert.equal(header.parentSession, sourcePath);

		// Messages should be preserved as-is (except usage is stripped)
		const msg1 = JSON.parse(lines[1]);
		assert.equal(msg1.id, "msg-1");
		assert.equal(msg1.message.role, "user");

		const msg2 = JSON.parse(lines[2]);
		assert.equal(msg2.id, "msg-2");
		assert.equal(msg2.message.role, "assistant");
		// Usage is replaced with zero stub (compiled binary needs message.usage.input on every entry)
		assert.deepEqual(msg2.message.usage, {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		});
	});

	it("cuts a fork before the assistant message that launched the child", () => {
		const sourcePath = join(tmpDir, "source-launch-cutoff.jsonl");
		const lines = [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "sess-1",
				timestamp: "2026-01-01T00:00:00.000Z",
				cwd: tmpDir,
			}),
			JSON.stringify({
				type: "message",
				id: "user-1",
				parentId: "sess-1",
				timestamp: "2026-01-01T00:00:01.000Z",
				message: {
					role: "user",
					content: [{ type: "text", text: "Original request" }],
					timestamp: Date.now(),
				},
			}),
			JSON.stringify({
				type: "message",
				id: "assistant-1",
				parentId: "user-1",
				timestamp: "2026-01-01T00:00:02.000Z",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Useful completed prior work" }],
					timestamp: Date.now(),
					usage: {
						input: 100,
						output: 10,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 110,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
					stopReason: "stop",
				},
			}),
			JSON.stringify({
				type: "custom_message",
				id: "prior-result",
				parentId: "assistant-1",
				timestamp: "2026-01-01T00:00:03.000Z",
				customType: "subagent_result",
				content: "Prior child result that later forks should inherit",
				display: true,
			}),
			JSON.stringify({
				type: "message",
				id: "user-2",
				parentId: "prior-result",
				timestamp: "2026-01-01T00:00:04.000Z",
				message: {
					role: "user",
					content: [{ type: "text", text: "Launch two children" }],
					timestamp: Date.now(),
				},
			}),
			JSON.stringify({
				type: "message",
				id: "assistant-launch",
				parentId: "user-2",
				timestamp: "2026-01-01T00:00:05.000Z",
				message: {
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "call-child-a",
							name: "subagent",
							arguments: { agent: "greeter", task: "A" },
						},
						{
							type: "toolCall",
							id: "call-child-b",
							name: "subagent",
							arguments: { agent: "greeter", task: "B" },
						},
					],
					timestamp: Date.now(),
					usage: {
						input: 200,
						output: 20,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 220,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
					stopReason: "toolUse",
				},
			}),
			JSON.stringify({
				type: "message",
				id: "tool-result-a",
				parentId: "assistant-launch",
				timestamp: "2026-01-01T00:00:06.000Z",
				message: {
					role: "toolResult",
					toolCallId: "call-child-a",
					toolName: "subagent",
					content: [{ type: "text", text: "Child A launched" }],
					isError: false,
					timestamp: Date.now(),
				},
			}),
		];
		writeFileSync(sourcePath, `${lines.join("\n")}\n`, "utf-8");

		const childPath = join(tmpDir, "child-launch-cutoff.jsonl");
		writeTrimmedForkSession(sourcePath, childPath, {
			childContextWindow: 100_000,
			reserveTokens: 10_000,
			launchToolCallId: "call-child-b",
		});

		const written = readFileSync(childPath, "utf-8");
		const entries = written
			.split("\n")
			.filter((l) => l.trim())
			.map((l) => JSON.parse(l));
		const ids = entries.map((e) => e.id).filter(Boolean);

		assertNeutralizedToolMetadata(entries);
		assert.ok(
			ids.includes("prior-result"),
			"prior completed subagent result is preserved",
		);
		assert.ok(
			ids.includes("user-2"),
			"current user request is preserved as context",
		);
		assert.equal(
			ids.includes("assistant-launch"),
			false,
			"current launching assistant is excluded",
		);
		assert.equal(
			ids.includes("tool-result-a"),
			false,
			"same-turn sibling tool result is excluded",
		);
		assert.equal(
			JSON.stringify(entries).includes("call-child-a"),
			false,
			"sibling launch call is not inherited",
		);
		assert.equal(
			JSON.stringify(entries).includes("call-child-b"),
			false,
			"own launch call is not inherited",
		);
	});

	it("preserves prior tool-call/tool-result pairs while cutting the current launch", () => {
		const sourcePath = join(tmpDir, "source-prior-subagent-redacted.jsonl");
		const lines = [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "sess-1",
				timestamp: "2026-01-01T00:00:00.000Z",
				cwd: tmpDir,
			}),
			JSON.stringify({
				type: "message",
				id: "user-1",
				parentId: "sess-1",
				timestamp: "2026-01-01T00:00:01.000Z",
				message: {
					role: "user",
					content: [{ type: "text", text: "Launch marker child" }],
					timestamp: Date.now(),
				},
			}),
			JSON.stringify({
				type: "message",
				id: "assistant-prior-launch",
				parentId: "user-1",
				timestamp: "2026-01-01T00:00:02.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "I will launch the marker child now." },
						{
							type: "toolCall",
							id: "call-prior",
							name: "subagent",
							arguments: { agent: "marker", task: "Return PRIOR_RESULT_OK" },
						},
					],
					timestamp: Date.now(),
					usage: {
						input: 100,
						output: 20,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 120,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
					stopReason: "toolUse",
				},
			}),
			JSON.stringify({
				type: "message",
				id: "prior-result",
				parentId: "assistant-prior-launch",
				timestamp: "2026-01-01T00:00:03.000Z",
				message: {
					role: "toolResult",
					toolCallId: "call-prior",
					toolName: "subagent",
					content: [
						{ type: "text", text: "Sub-agent completed.\n\nPRIOR_RESULT_OK" },
					],
					isError: false,
					timestamp: Date.now(),
				},
			}),
			JSON.stringify({
				type: "message",
				id: "assistant-after-prior",
				parentId: "prior-result",
				timestamp: "2026-01-01T00:00:04.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "Prior result was PRIOR_RESULT_OK." },
					],
					timestamp: Date.now(),
					usage: {
						input: 140,
						output: 10,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 150,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
					stopReason: "stop",
				},
			}),
			JSON.stringify({
				type: "message",
				id: "user-2",
				parentId: "assistant-after-prior",
				timestamp: "2026-01-01T00:00:05.000Z",
				message: {
					role: "user",
					content: [{ type: "text", text: "Launch observer" }],
					timestamp: Date.now(),
				},
			}),
			JSON.stringify({
				type: "message",
				id: "assistant-current-launch",
				parentId: "user-2",
				timestamp: "2026-01-01T00:00:06.000Z",
				message: {
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "call-current",
							name: "subagent",
							arguments: { agent: "observer", task: "Check prior" },
						},
					],
					timestamp: Date.now(),
					usage: {
						input: 180,
						output: 10,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 190,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
					stopReason: "toolUse",
				},
			}),
		];
		writeFileSync(sourcePath, `${lines.join("\n")}\n`, "utf-8");

		const childPath = join(tmpDir, "child-prior-subagent-preserved.jsonl");
		writeTrimmedForkSession(sourcePath, childPath, {
			childContextWindow: 100_000,
			reserveTokens: 10_000,
			launchToolCallId: "call-current",
		});

		const written = readFileSync(childPath, "utf-8");
		const entries = written
			.split("\n")
			.filter((l) => l.trim())
			.map((l) => JSON.parse(l));
		const priorAssistant = entries.find(
			(entry) => entry.id === "assistant-prior-launch",
		);

		assertNeutralizedToolMetadata(entries);
		assert.ok(
			priorAssistant,
			"prior assistant entry remains to keep the parentId chain intact",
		);
		// After neutralization, raw toolCall IDs are converted to [tool call: name] text
		const priorContent = JSON.stringify(priorAssistant.message.content);
		assert.ok(
			priorContent.includes("[tool call: subagent]"),
			"prior tool call is neutralized to [tool call: subagent] placeholder",
		);
		assert.ok(
			JSON.stringify(entries).includes("PRIOR_RESULT_OK"),
			"prior completed result remains available",
		);
		const priorResult = entries.find((entry) => entry.id === "prior-result");
		assert.equal(
			priorResult.message.toolCallId,
			undefined,
			"prior tool result has toolCallId stripped by neutralization",
		);
		assert.equal(
			JSON.stringify(entries).includes("call-current"),
			false,
			"current launch is excluded",
		);
	});

	it("trims oldest turns when the session exceeds budget", () => {
		const sourcePath = join(tmpDir, "source-reasonable.jsonl");
		const lines = [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "sess-1",
				timestamp: "2026-01-01T00:00:00.000Z",
				cwd: tmpDir,
			}),
		];

		// 3 turns with cumulative context: [100, 200, 300]
		for (let i = 0; i < 3; i++) {
			const prevId = i === 0 ? "sess-1" : `assistant-${i}`;
			const cumulativeInput = (i + 1) * 100;
			lines.push(
				JSON.stringify({
					type: "message",
					id: `user-${i + 1}`,
					parentId: prevId,
					timestamp: `2026-01-01T00:00:0${i + 1}.000Z`,
					message: {
						role: "user",
						content: [{ type: "text", text: `msg` }],
						timestamp: Date.now(),
					},
				}),
			);
			lines.push(
				JSON.stringify({
					type: "message",
					id: `assistant-${i + 1}`,
					parentId: `user-${i + 1}`,
					timestamp: `2026-01-01T00:00:0${i + 2}.000Z`,
					message: {
						role: "assistant",
						content: [{ type: "text", text: `resp` }],
						timestamp: Date.now(),
						usage: {
							input: 80,
							output: 10,
							cacheRead: cumulativeInput - 80,
							cacheWrite: 0,
							totalTokens: cumulativeInput + 10,
							cost: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								total: 0,
							},
						},
						stopReason: "stop",
					},
				}),
			);
		}
		writeFileSync(sourcePath, `${lines.join("\n")}\n`, "utf-8");

		const childPath = join(tmpDir, "child-reasonable.jsonl");

		// total=300, budget=150, overflow=150.
		// Going forward: ass-1 prevCum=0 >= 150? No.
		//                ass-2 prevCum=100 >= 150? No.
		//                ass-3 prevCum=200 >= 150? Yes. Keep from after ass-2 (only last turn).
		writeTrimmedForkSession(sourcePath, childPath, {
			childContextWindow: 1_150,
			reserveTokens: 1_000,
		});

		const written = readFileSync(childPath, "utf-8");
		const resultLines = written.split("\n").filter((l) => l.trim());
		assert.ok(
			resultLines.length >= 2,
			"Should have at least header + some entries",
		);
		const entries = resultLines.map((l) => JSON.parse(l));
		const messageEntries = entries.filter((e) => e.type === "message");

		// Only the last turn (assistant-3) fits within 150 budget
		const lastAssistant = messageEntries.find((e) => e.id === "assistant-3");
		assert.ok(lastAssistant, "Last assistant should be kept");
		const firstAssistant = messageEntries.find((e) => e.id === "assistant-1");
		assert.equal(
			firstAssistant,
			undefined,
			"First 2 turns should be trimmed (total 200 > budget 150)",
		);
	});

});
