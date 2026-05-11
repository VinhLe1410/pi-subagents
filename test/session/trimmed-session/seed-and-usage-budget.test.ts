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
} from "./support.ts";

describe("writeTrimmedForkSession", () => {
	let tmpDir: string;

	before(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "trimmed-session-test-"));
	});

	after(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("actually trims when cumulative context exceeds budget", () => {
		const sourcePath = join(tmpDir, "source-trim.jsonl");
		const lines = [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "sess-1",
				timestamp: "2026-01-01T00:00:00.000Z",
				cwd: tmpDir,
			}),
		];

		// 5 turns with cumulative context growing by 100 each time
		// assistant-5 has cumulative input = 500
		for (let i = 0; i < 5; i++) {
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
						content: [{ type: "text", text: `Turn ${i + 1} user` }],
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
						content: [{ type: "text", text: `Turn ${i + 1} response` }],
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

		const childPath = join(tmpDir, "child-trim.jsonl");

		// total=500, budget=250, overflow=250.
		// ass-1 prevCum=0 >= 250? No.  ass-2 prevCum=100 >= 250? No.
		// ass-3 prevCum=200 >= 250? No. ass-4 prevCum=300 >= 250? Yes!
		// First kept = after ass-3. Turns 4+5 kept (200 tokens <= 250 budget).
		writeTrimmedForkSession(sourcePath, childPath, {
			childContextWindow: 1_250,
			reserveTokens: 1_000,
		});

		const written = readFileSync(childPath, "utf-8");
		const resultLines = written.split("\n").filter((l) => l.trim());

		const entries = resultLines.map((l) => JSON.parse(l));
		const messageEntries = entries.filter((e) => e.type === "message");
		const keptIds = messageEntries.map((e) => e.id);

		assert.equal(keptIds.includes("assistant-1"), false, "assistant-1 trimmed");
		assert.equal(keptIds.includes("assistant-2"), false, "assistant-2 trimmed");
		assert.equal(
			keptIds.includes("assistant-3"),
			false,
			"assistant-3 trimmed (prevCum=200 < overflow=250)",
		);
		// Turns 4-5 kept (assistant-4 + assistant-5, suffix = 200 tokens)
		assert.ok(keptIds.includes("assistant-4"), "assistant-4 kept");
		assert.ok(keptIds.includes("assistant-5"), "assistant-5 kept");
	});

	it("writes only header when session has no assistant messages", () => {
		const sourcePath = join(tmpDir, "source-no-assistant.jsonl");
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
				id: "msg-1",
				parentId: "sess-1",
				timestamp: "2026-01-01T00:00:01.000Z",
				message: {
					role: "user",
					content: [{ type: "text", text: "hello" }],
					timestamp: Date.now(),
				},
			}),
		];
		writeFileSync(sourcePath, `${lines.join("\n")}\n`, "utf-8");

		const childPath = join(tmpDir, "child-no-assistant.jsonl");
		writeTrimmedForkSession(sourcePath, childPath, {
			childContextWindow: 100_000,
		});

		const written = readFileSync(childPath, "utf-8");
		const resultLines = written.split("\n").filter((l) => l.trim());
		assert.equal(
			resultLines.length,
			1,
			"Should only have header when no assistant responses exist",
		);
		const header = JSON.parse(resultLines[0]);
		assert.equal(header.type, "session");
	});

	it("preserves non-message entries but guards renderer crash with zero usage", () => {
		const sourcePath = join(tmpDir, "source-non-msg.jsonl");
		const lines = [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "sess-1",
				timestamp: "2026-01-01T00:00:00.000Z",
				cwd: tmpDir,
			}),
			JSON.stringify({
				type: "custom_message",
				id: "custom-1",
				parentId: "sess-1",
				timestamp: "2026-01-01T00:00:01.000Z",
				customType: "test",
				content: "hello",
			}),
			JSON.stringify({
				type: "message",
				id: "msg-1",
				parentId: "custom-1",
				timestamp: "2026-01-01T00:00:02.000Z",
				message: {
					role: "user",
					content: [{ type: "text", text: "Hello" }],
					timestamp: Date.now(),
				},
			}),
			JSON.stringify({
				type: "message",
				id: "msg-2",
				parentId: "msg-1",
				timestamp: "2026-01-01T00:00:03.000Z",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Hi" }],
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
		];
		writeFileSync(sourcePath, `${lines.join("\n")}\n`, "utf-8");

		const childPath = join(tmpDir, "child-non-msg.jsonl");
		writeTrimmedForkSession(sourcePath, childPath, {
			childContextWindow: 100_000,
		});

		const written = readFileSync(childPath, "utf-8");
		const resultLines = written.split("\n").filter((l) => l.trim());
		const entries = resultLines.map((l) => JSON.parse(l));

		const customEntry = entries.find((e) => e.type === "custom_message");
		assert.ok(
			customEntry,
			"custom_message should be preserved (with zero usage guard)",
		);
		// Every non-session entry must have message.usage.input for the compiled binary's renderer
		for (const e of entries) {
			if (e.type === "session") continue;
			if (e.type === "message" && e.message?.role !== "custom") continue;
			assert.ok(
				e.message?.usage?.input !== undefined,
				`${e.type} entry must have message.usage.input`,
			);
		}
	});

	it("trims via seedSubagentSessionFileForTest when forkTrimOptions is provided", async () => {
		// Build a session with 5 turns (cumulative 500 tokens)
		const sourcePath = join(tmpDir, "source-seed-integration.jsonl");
		const lines = [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "sess-1",
				timestamp: "2026-01-01T00:00:00.000Z",
				cwd: tmpDir,
			}),
		];
		for (let i = 0; i < 5; i++) {
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
						content: [{ type: "text", text: `Turn ${i + 1} user` }],
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
						content: [{ type: "text", text: `Turn ${i + 1} response` }],
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

		const childPath = join(tmpDir, "child-seed-integration.jsonl");

		const { seedSubagentSessionFileForTest } = await import(
			"../../../src/subagents.ts"
		);
		seedSubagentSessionFileForTest(
			"fork",
			sourcePath,
			childPath,
			tmpDir,
			{ childContextWindow: 1_250, reserveTokens: 1_000 }, // budget=250, ass-2 cum=200 fits
		);

		const written = readFileSync(childPath, "utf-8");
		const resultLines = written.split("\n").filter((l) => l.trim());
		const entries = resultLines.map((l) => JSON.parse(l));
		const messageEntries = entries.filter((e) => e.type === "message");
		const keptIds = messageEntries.map((e) => e.id);

		// Same trim behavior: turns 1-3 trimmed, turns 4-5 kept
		assert.equal(
			keptIds.includes("assistant-1"),
			false,
			"seedSubagentSessionFileForTest: assistant-1 trimmed",
		);
		assert.equal(keptIds.includes("assistant-3"), false, "assistant-3 trimmed");
		assert.ok(
			keptIds.includes("assistant-4"),
			"assistant-4 kept after trimming",
		);
	});

	it("writes header-only when every assistant usage checkpoint is zero", () => {
		const sourcePath = join(tmpDir, "source-zero-usage.jsonl");
		const destPath = join(tmpDir, "dest-zero-usage.jsonl");
		const hugeOld = "old ".repeat(2000);
		const recentTask = "recent task";
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
				message: { role: "user", content: [{ type: "text", text: hugeOld }] },
			}),
			JSON.stringify({
				type: "message",
				id: "a-old",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "old reply" }],
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
				},
			}),
			JSON.stringify({
				type: "message",
				id: "u-new",
				message: {
					role: "user",
					content: [{ type: "text", text: recentTask }],
				},
			}),
			JSON.stringify({
				type: "message",
				id: "a-new",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "recent reply" }],
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
				},
			}),
		];
		writeFileSync(sourcePath, `${lines.join("\n")}\n`);

		writeTrimmedForkSession(sourcePath, destPath, {
			childContextWindow: 11_000,
			reserveTokens: 10_000,
		});

		const output = readFileSync(destPath, "utf8");
		assert.ok(
			!output.includes(hugeOld),
			"zero-usage history should not be inherited",
		);
		assert.ok(
			!output.includes(recentTask),
			"no deterministic token checkpoint exists for the recent turn",
		);
	});

	it("trusts monotonic usage checkpoints without serialized-size heuristics", () => {
		const sourcePath = join(tmpDir, "source-underreported-usage.jsonl");
		const destPath = join(tmpDir, "dest-underreported-usage.jsonl");
		const hugeOld = "old context ".repeat(5000);
		const recentTask = "recent underreported task";
		const usage = {
			input: 100,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 100,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
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
				message: { role: "user", content: [{ type: "text", text: hugeOld }] },
			}),
			JSON.stringify({
				type: "message",
				id: "a-old",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "old reply" }],
					usage,
				},
			}),
			JSON.stringify({
				type: "message",
				id: "u-new",
				message: {
					role: "user",
					content: [{ type: "text", text: recentTask }],
				},
			}),
			JSON.stringify({
				type: "message",
				id: "a-new",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "recent reply" }],
					usage,
				},
			}),
		];
		writeFileSync(sourcePath, `${lines.join("\n")}\n`);

		writeTrimmedForkSession(sourcePath, destPath, {
			childContextWindow: 11_000,
			reserveTokens: 10_000,
		});

		const output = readFileSync(destPath, "utf8");
		assert.ok(
			output.includes(hugeOld),
			"deterministic trim should trust sane persisted usage, not serialized-size heuristics",
		);
		assert.ok(output.includes(recentTask), "recent turn should be kept");
	});

});
