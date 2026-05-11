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

	it("treats decreasing usage checkpoints as reset boundaries", () => {
		const sourcePath = join(tmpDir, "source-checkpoint-reset.jsonl");
		const childPath = join(tmpDir, "child-checkpoint-reset.jsonl");
		const oldContext = "before reset";
		const newContext = "after reset";
		const lines = [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "s",
				timestamp: new Date().toISOString(),
				cwd: tmpDir,
			}),
			JSON.stringify({
				type: "message",
				id: "u-old",
				message: {
					role: "user",
					content: [{ type: "text", text: oldContext }],
				},
			}),
			JSON.stringify({
				type: "message",
				id: "a-old",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "old reply" }],
					usage: {
						input: 50000,
						output: 10,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 50010,
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
				id: "u-new",
				message: {
					role: "user",
					content: [{ type: "text", text: newContext }],
				},
			}),
			JSON.stringify({
				type: "message",
				id: "a-new",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "new reply" }],
					usage: {
						input: 1000,
						output: 10,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 1010,
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
		];
		writeFileSync(sourcePath, `${lines.join("\n")}\n`);

		writeTrimmedForkSession(sourcePath, childPath, {
			childContextWindow: 11_000,
			reserveTokens: 10_000,
		});

		const output = readFileSync(childPath, "utf8");
		assert.ok(
			!output.includes(oldContext),
			"entries before a usage reset boundary should not be mixed into the fork",
		);
		assert.ok(
			output.includes(newContext),
			"latest checkpoint segment should be kept",
		);
	});

	it("writes header-only when zeroed inherited usage has no later real checkpoint", () => {
		const sourcePath = join(
			tmpDir,
			"source-zero-inherited-no-checkpoint.jsonl",
		);
		const childPath = join(tmpDir, "child-zero-inherited-no-checkpoint.jsonl");
		const inheritedContext = "inherited parent context";
		const trailingUser = "trailing uncheckpointed user ".repeat(1000);
		const lines = [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "s",
				timestamp: new Date().toISOString(),
				cwd: tmpDir,
			}),
			JSON.stringify({
				type: "message",
				id: "u-inherited",
				message: {
					role: "user",
					content: [{ type: "text", text: inheritedContext }],
				},
			}),
			JSON.stringify({
				type: "message",
				id: "a-inherited",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "inherited reply" }],
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
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
				id: "u-trailing",
				message: {
					role: "user",
					content: [{ type: "text", text: trailingUser }],
				},
			}),
		];
		writeFileSync(sourcePath, `${lines.join("\n")}\n`);

		writeTrimmedForkSession(sourcePath, childPath, {
			childContextWindow: 11_000,
			reserveTokens: 10_000,
		});

		const output = readFileSync(childPath, "utf8");
		assert.ok(
			!output.includes(inheritedContext),
			"zeroed inherited context should not be inherited",
		);
		assert.ok(
			!output.includes(trailingUser),
			"uncheckpointed trailing user content should not be inherited",
		);
	});

	it("lets nested forks skip zeroed inherited usage and use later real checkpoints", () => {
		const sourcePath = join(tmpDir, "source-nested-zero-inherited.jsonl");
		const childPath = join(tmpDir, "child-nested-zero-inherited.jsonl");
		const inheritedContext = "inherited parent context";
		const childContext = "child-owned context";
		const lines = [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "s",
				timestamp: new Date().toISOString(),
				cwd: tmpDir,
			}),
			JSON.stringify({
				type: "message",
				id: "u-inherited",
				message: {
					role: "user",
					content: [{ type: "text", text: inheritedContext }],
				},
			}),
			JSON.stringify({
				type: "message",
				id: "a-inherited",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "inherited reply" }],
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
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
				id: "u-child",
				message: {
					role: "user",
					content: [{ type: "text", text: childContext }],
				},
			}),
			JSON.stringify({
				type: "message",
				id: "a-child",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "child reply" }],
					usage: {
						input: 1200,
						output: 10,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 1210,
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
		];
		writeFileSync(sourcePath, `${lines.join("\n")}\n`);

		writeTrimmedForkSession(sourcePath, childPath, {
			childContextWindow: 11_000,
			reserveTokens: 10_000,
		});

		const output = readFileSync(childPath, "utf8");
		assert.ok(
			!output.includes(inheritedContext),
			"zeroed inherited segment should be dropped",
		);
		assert.ok(
			output.includes(childContext),
			"later child-owned checkpoint segment should be kept",
		);
	});

	it("writes header-only when budget is negative (reserve >= contextWindow)", () => {
		const sourcePath = createMinimalSession(tmpDir);
		const childPath = join(tmpDir, "child-negative-budget.jsonl");

		// reserveTokens (100000) >= childContextWindow (50000) → budget = -50000
		writeTrimmedForkSession(sourcePath, childPath, {
			childContextWindow: 50000,
			reserveTokens: 100000,
		});

		const written = readFileSync(childPath, "utf-8");
		const resultLines = written.split("\n").filter((l) => l.trim());
		assert.equal(
			resultLines.length,
			1,
			"Should only have header when budget is negative",
		);
		const header = JSON.parse(resultLines[0]);
		assert.equal(header.type, "session");
	});

	it("strips stale usage metadata to prevent false compaction in child", () => {
		const sourcePath = join(tmpDir, "source-usage-strip.jsonl");
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
					content: [{ type: "text", text: "Hello" }],
					timestamp: Date.now(),
				},
			}),
			// This assistant has stale usage with totalTokens=100100
			JSON.stringify({
				type: "message",
				id: "assistant-1",
				parentId: "user-1",
				timestamp: "2026-01-01T00:00:02.000Z",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Hi" }],
					timestamp: Date.now(),
					usage: {
						input: 50000,
						output: 100,
						cacheRead: 50000,
						cacheWrite: 0,
						totalTokens: 100100,
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
		];
		writeFileSync(sourcePath, `${lines.join("\n")}\n`, "utf-8");

		const childPath = join(tmpDir, "child-usage-strip.jsonl");
		writeTrimmedForkSession(sourcePath, childPath, {
			childContextWindow: 262144,
		});

		const written = readFileSync(childPath, "utf-8");
		const resultLines = written.split("\n").filter((l) => l.trim());
		const entries = resultLines.map((l) => JSON.parse(l));

		// Verify usage is stripped from the assistant message
		const assistantMsg = entries.find(
			(e) => e.type === "message" && e.message?.role === "assistant",
		);
		assert.ok(assistantMsg, "assistant message should exist");
		assert.deepEqual(
			assistantMsg.message.usage,
			{
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			"usage replaced with zero stub to prevent false compaction while keeping renderer alive",
		);
		// Content should be preserved
		assert.equal(assistantMsg.message.content[0].text, "Hi");
		// Non-assistant messages should be untouched
		const userMsg = entries.find(
			(e) => e.type === "message" && e.message?.role === "user",
		);
		assert.ok(userMsg, "user message should exist");
		assert.equal(userMsg.message.content[0].text, "Hello");
	});
	it("handles large-session scenario where totalContext >> budget", () => {
		// Simulate: 100 turns with cumulative growing by 10k each → total = 1,000,000
		// Budget = 250,000 (window=260k - reserve)
		const sourcePath = join(tmpDir, "source-large.jsonl");
		const lines = [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "sess-1",
				timestamp: "2026-01-01T00:00:00.000Z",
				cwd: tmpDir,
			}),
		];
		for (let i = 0; i < 100; i++) {
			const prevId = i === 0 ? "sess-1" : `assistant-${i}`;
			const cumulativeInput = (i + 1) * 10_000;
			lines.push(
				JSON.stringify({
					type: "message",
					id: `user-${i + 1}`,
					parentId: prevId,
					timestamp: `2026-01-01T00:00:0${i + 1}.000Z`,
					message: {
						role: "user",
						content: [{ type: "text", text: "msg" }],
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
						content: [{ type: "text", text: "resp" }],
						timestamp: Date.now(),
						usage: {
							input: 9000,
							output: 1000,
							cacheRead: cumulativeInput - 9000,
							cacheWrite: 0,
							totalTokens: cumulativeInput + 1000,
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

		const childPath = join(tmpDir, "child-large.jsonl");
		// total=1,000,000, budget=250,000, overflow=750,000
		// ass-75 has cumBefore=740k. 740k >= 750k? No. ass-76 has cumBefore=750k. 750k >= 750k? Yes.
		// First kept = after ass-75. Keep turns 76-100 (25 turns).
		writeTrimmedForkSession(sourcePath, childPath, {
			childContextWindow: 260_000,
			reserveTokens: 10_000,
		});

		const written = readFileSync(childPath, "utf-8");
		const resultLines = written.split("\n").filter((l) => l.trim());
		const entries = resultLines.map((l) => JSON.parse(l));
		const messageEntries = entries.filter((e) => e.type === "message");
		const keptIds = messageEntries.map((e) => e.id);

		// Turns 1-75 should be trimmed
		assert.equal(
			keptIds.includes("assistant-1"),
			false,
			"first assistant trimmed",
		);
		assert.equal(
			keptIds.includes("assistant-50"),
			false,
			"mid-session assistant trimmed",
		);
		assert.equal(
			keptIds.includes("assistant-75"),
			false,
			"assistant-75 trimmed (prevCum=740k < overflow)",
		);

		// Turns 76-100 should be kept
		assert.ok(keptIds.includes("assistant-76"), "assistant-76 kept");
		assert.ok(keptIds.includes("assistant-100"), "assistant-100 kept");

		// Verify the kept suffix fits within budget
		const _allAssistants = messageEntries.filter(
			(e) => e.message.role === "assistant",
		);
		const lastKeptCum = 100 * 10_000; // assistant-100 cumulative
		const beforeKeptCum = 75 * 10_000; // assistant-75 cumulative
		const estimatedSuffixTokens = lastKeptCum - beforeKeptCum; // = 250,000
		assert.ok(
			estimatedSuffixTokens <= 250_000,
			"kept suffix should fit within budget",
		);
	});
});
