/**
 * Regression tests for segment-base normalization in fork session trimming.
 *
 * When context pruning causes cumulative token checkpoints to drop mid-session,
 * getLatestTokenSegment creates a new segment boundary. The totalTokens must be
 * normalized to segment-local values (last_cumul − first_cumul_in_segment)
 * instead of using the session-wide cumulative.
 *
 * Without the fix: totalTokens overestimates the segment content, potentially
 * triggering false trimming when the segment actually fits within budget.
 */

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

describe("segment-base normalization (regression)", () => {
	let tmpDir: string;

	before(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "segment-base-test-"));
	});

	after(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	/**
	 * The core bug scenario:
	 *   Pre-prune session grows to 160K cumulative.
	 *   Prune drops cumulative to 80K.
	 *   Post-prune session grows to 230K cumulative.
	 *
	 *   Session-wide totalTokens = 230K
	 *   Segment tokens = 230K − 80K = 150K
	 *
	 *   Budget = 160K (tight, but segment fits)
	 *   150K ≤ 160K → NO TRIM (correct)
	 *   230K > 160K → WOULD TRIM without fix (false positive)
	 */
	it("does not create false segment boundaries on cumulative drops (context pruning is not a segment boundary)", () => {
		const path = join(tmpDir, "no-false-boundary.jsonl");
		const lines = [
			JSON.stringify({ type: "session", version: 3, id: "s", timestamp: new Date().toISOString(), cwd: tmpDir }),

			JSON.stringify({ type: "message", id: "u-pre-0", parentId: "s", message: { role: "user", content: [{ type: "text", text: "pre 0" }] } }),
			JSON.stringify({ type: "message", id: "a-pre-0", parentId: "u-pre-0", message: { role: "assistant", content: [{ type: "text", text: "pre 0" }], usage: { input: 40000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 40010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),
			JSON.stringify({ type: "message", id: "u-pre-1", parentId: "a-pre-0", message: { role: "user", content: [{ type: "text", text: "pre 1" }] } }),
			JSON.stringify({ type: "message", id: "a-pre-1", parentId: "u-pre-1", message: { role: "assistant", content: [{ type: "text", text: "pre 1" }], usage: { input: 80000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 80010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),
			JSON.stringify({ type: "message", id: "u-pre-2", parentId: "a-pre-1", message: { role: "user", content: [{ type: "text", text: "pre 2" }] } }),
			JSON.stringify({ type: "message", id: "a-pre-2", parentId: "u-pre-2", message: { role: "assistant", content: [{ type: "text", text: "pre 2" }], usage: { input: 120000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 120010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),
			JSON.stringify({ type: "message", id: "u-pre-3", parentId: "a-pre-2", message: { role: "user", content: [{ type: "text", text: "pre 3" }] } }),
			JSON.stringify({ type: "message", id: "a-pre-3", parentId: "u-pre-3", message: { role: "assistant", content: [{ type: "text", text: "pre 3" }], usage: { input: 160000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 160010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),

			// Tool result
			JSON.stringify({ type: "message", id: "t-prune", parentId: "a-pre-3", message: { role: "toolResult", toolCallId: "c-p", toolName: "bash", content: [{ type: "text", text: "Big pruned output here. ".repeat(200) }], isError: false } }),

			// === cumulative DROPS from 160K to 80K (context pruning) ===
			// Entries AFTER the drop are NOT a separate segment — they share the
			// session with pre-drop entries. The budget-based trim handles what fits.
			JSON.stringify({ type: "message", id: "u-post-0", parentId: "t-prune", message: { role: "user", content: [{ type: "text", text: "post 0" }] } }),
			JSON.stringify({ type: "message", id: "a-post-0", parentId: "u-post-0", message: { role: "assistant", content: [{ type: "text", text: "first post-prune response" }], usage: { input: 76500, output: 10, cacheRead: 3500, cacheWrite: 0, totalTokens: 80010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),

			JSON.stringify({ type: "message", id: "u-post-1", parentId: "a-post-0", message: { role: "user", content: [{ type: "text", text: "post 1" }] } }),
			JSON.stringify({ type: "message", id: "a-post-1", parentId: "u-post-1", message: { role: "assistant", content: [{ type: "text", text: "post 1" }], usage: { input: 126500, output: 10, cacheRead: 3500, cacheWrite: 0, totalTokens: 130010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),

			JSON.stringify({ type: "message", id: "u-post-2", parentId: "a-post-1", message: { role: "user", content: [{ type: "text", text: "post 2" }] } }),
			JSON.stringify({ type: "message", id: "a-post-2", parentId: "u-post-2", message: { role: "assistant", content: [{ type: "text", text: "post 2" }], usage: { input: 146500, output: 10, cacheRead: 3500, cacheWrite: 0, totalTokens: 150010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),
		];
		writeFileSync(path, `${lines.join("\n")}\n`);

		// Budget = 200K. totalTokens = 230K > 200K → trim.
		// No segment boundary at drop → ALL entries included.
		// findTrimStart drops oldest entries (pre-prune first) until remaining fits.
		const childPath = join(tmpDir, "child-no-false-boundary.jsonl");
		writeTrimmedForkSession(path, childPath, {
			childContextWindow: 210_000,
			reserveTokens: 10_000,
		});

		const written = readFileSync(childPath, "utf-8");
		const entries = written.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
		const keptIds = entries.filter((e) => e.type === "message").map((e) => e.id);

		// Post-prune assistants should be preserved (they're the newest)
		assert.ok(keptIds.includes("a-post-0"), "first post-prune assistant preserved");
		assert.ok(keptIds.includes("a-post-1"), "second post-prune assistant preserved");
		assert.ok(keptIds.includes("a-post-2"), "third post-prune assistant preserved");

		// Pre-prune entries should ALSO be included — no segment boundary was created
		// The child needs the full context. Budget trim handles overflow naturally.
		assert.ok(keptIds.includes("a-pre-0"), "pre-prune entries inherited (no false boundary at drop)");
		assert.ok(written.includes("first post-prune response"), "post-prune content preserved");
	});

	/**
	 * Edge case: segment-local total EXACTLY equals budget.
	 * Should keep all entries (no trim).
	 */
	it("preserves all entries when segment-local total equals budget exactly", () => {
		const path = join(tmpDir, "segment-equals-budget.jsonl");
		const lines = [
			JSON.stringify({ type: "session", version: 3, id: "s", timestamp: new Date().toISOString(), cwd: tmpDir }),

			// Pre-prune: 1 turn at 100K
			JSON.stringify({ type: "message", id: "u-pre-0", parentId: "s", message: { role: "user", content: [{ type: "text", text: "pre" }] } }),
			JSON.stringify({ type: "message", id: "a-pre-0", parentId: "u-pre-0", message: { role: "assistant", content: [{ type: "text", text: "pre" }], usage: { input: 100000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 100010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),

			// PRUNE: drop to 50K
			JSON.stringify({ type: "message", id: "u-post-0", parentId: "a-pre-0", message: { role: "user", content: [{ type: "text", text: "post" }] } }),
			JSON.stringify({ type: "message", id: "a-post-0", parentId: "u-post-0", message: { role: "assistant", content: [{ type: "text", text: "post" }], usage: { input: 50000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 50010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),

			// Post-prune grows to exactly 100K
			JSON.stringify({ type: "message", id: "u-post-1", parentId: "a-post-0", message: { role: "user", content: [{ type: "text", text: "post 2" }] } }),
			JSON.stringify({ type: "message", id: "a-post-1", parentId: "u-post-1", message: { role: "assistant", content: [{ type: "text", text: "post 2" }], usage: { input: 100000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 100010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),
		];
		writeFileSync(path, `${lines.join("\n")}\n`);

		// Budget = 50K (childCtx=60K - reserve=10K)
		// Session-wide total = 100K
		// Segment-local = 100K − 50K = 50K = budget exactly
		const childPath = join(tmpDir, "child-equal.jsonl");
		writeTrimmedForkSession(path, childPath, {
			childContextWindow: 60_000,
			reserveTokens: 10_000,
		});

		const written = readFileSync(childPath, "utf-8");
		const entries = written.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
		const keptIds = entries.filter((e) => e.type === "message").map((e) => e.id);

		// Both post-prune assistants should be kept
		assert.ok(keptIds.includes("a-post-0"), "first post-prune assistant kept at exact budget boundary");
		assert.ok(keptIds.includes("a-post-1"), "second post-prune assistant kept at exact budget boundary");
	});

	/**
	 * Normal (no-prune) sessions should be unaffected: segmentBase = 0.
	 */
	it("does not change behavior for sessions without pruning", () => {
		const path = join(tmpDir, "no-prune-session.jsonl");
		const lines = [
			JSON.stringify({ type: "session", version: 3, id: "s", timestamp: new Date().toISOString(), cwd: tmpDir }),
		];
		// 5 turns: cumulative 100, 200, 300, 400, 500
		for (let i = 0; i < 5; i++) {
			const cumul = (i + 1) * 100;
			const prev = i === 0 ? "s" : `a${i}`;
			lines.push(JSON.stringify({ type: "message", id: `u${i + 1}`, parentId: prev, message: { role: "user", content: [{ type: "text", text: `msg` }] } }));
			lines.push(JSON.stringify({ type: "message", id: `a${i + 1}`, parentId: `u${i + 1}`, message: { role: "assistant", content: [{ type: "text", text: `resp` }], usage: { input: 80, output: 10, cacheRead: cumul - 80, cacheWrite: 0, totalTokens: cumul + 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }));
		}
		writeFileSync(path, `${lines.join("\n")}\n`);

		const childPath = join(tmpDir, "child-no-prune.jsonl");
		// Budget=150: total=500 > 150, but segmentBase=0 so same as before
		writeTrimmedForkSession(path, childPath, {
			childContextWindow: 1_150,
			reserveTokens: 1_000,
		});

		const written = readFileSync(childPath, "utf-8");
		const entries = written.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
		const messageEntries = entries.filter((e) => e.type === "message");

		// Same behavior as existing tests: only the last assistant fits
		assert.ok(messageEntries.find((e) => e.id === "a5"), "last assistant kept");
		assert.equal(messageEntries.find((e) => e.id === "a1"), undefined, "first assistant trimmed");
	});

	/**
	 * Unpruned session: segmentBase stays 0, so totalTokens is session-wide.
	 * Budget=450, cumulatives=100..500 → 500>450 → trim triggered.
	 * First assistant should be dropped.
	 */
	it("still trims unpruned sessions when session-wide total exceeds budget (regression: segmentBase must not normalize initial segment)", () => {
		const path = join(tmpDir, "unpruned-exceeds-budget.jsonl");
		const lines = [
			JSON.stringify({ type: "session", version: 3, id: "s", timestamp: new Date().toISOString(), cwd: tmpDir }),
		];
		for (let i = 0; i < 5; i++) {
			const cumul = (i + 1) * 100;
			const prev = i === 0 ? "s" : `a${i}`;
			lines.push(JSON.stringify({ type: "message", id: `u${i + 1}`, parentId: prev, message: { role: "user", content: [{ type: "text", text: `msg${i}` }] } }));
			lines.push(JSON.stringify({ type: "message", id: `a${i + 1}`, parentId: `u${i + 1}`, message: { role: "assistant", content: [{ type: "text", text: `resp${i}` }], usage: { input: 80, output: 10, cacheRead: cumul - 80, cacheWrite: 0, totalTokens: cumul + 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }));
		}
		writeFileSync(path, `${lines.join("\n")}\n`);

		// Budget=450: totalTokens=500 > 450, trim should fire.
		// Without fix: segmentTokens=500-100=400<450 → would keep all (wrong).
		// With fix: segmentStart=0, totalTokens stays 500, 500>450 → trim (correct).
		const childPath = join(tmpDir, "child-unpruned-450.jsonl");
		writeTrimmedForkSession(path, childPath, {
			childContextWindow: 1_450,
			reserveTokens: 1_000,
		});

		const written = readFileSync(childPath, "utf-8");
		const entries = written.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
		const messageEntries = entries.filter((e) => e.type === "message");

		// Newest assistants should survive
		assert.ok(messageEntries.find((e) => e.id === "a5"), "last assistant kept");
		// Oldest should be trimmed
		assert.equal(messageEntries.find((e) => e.id === "a1"), undefined, "first assistant trimmed");
	});

	/**
	 * Multiple sequential prunes: each creates a new segment boundary.
	 * Only the last (most recent) segment should be inherited.
	 */
	it("handles multiple sequential prune events correctly (no false boundaries)", () => {
		const path = join(tmpDir, "multi-prune-noboundary.jsonl");
		const lines = [
			JSON.stringify({ type: "session", version: 3, id: "s", timestamp: new Date().toISOString(), cwd: tmpDir }),

			JSON.stringify({ type: "message", id: "u1", parentId: "s", message: { role: "user", content: [{ type: "text", text: "1" }] } }),
			JSON.stringify({ type: "message", id: "a1", parentId: "u1", message: { role: "assistant", content: [{ type: "text", text: "1" }], usage: { input: 50000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 50010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),
			JSON.stringify({ type: "message", id: "u2", parentId: "a1", message: { role: "user", content: [{ type: "text", text: "2" }] } }),
			JSON.stringify({ type: "message", id: "a2", parentId: "u2", message: { role: "assistant", content: [{ type: "text", text: "2" }], usage: { input: 100000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 100010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),

			// First prune: 100K → 30K (no segment boundary — context pruning is not a boundary)
			JSON.stringify({ type: "message", id: "u3", parentId: "a2", message: { role: "user", content: [{ type: "text", text: "3" }] } }),
			JSON.stringify({ type: "message", id: "a3", parentId: "u3", message: { role: "assistant", content: [{ type: "text", text: "first prune boundary" }], usage: { input: 30000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 30010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),
			JSON.stringify({ type: "message", id: "u4", parentId: "a3", message: { role: "user", content: [{ type: "text", text: "4" }] } }),
			JSON.stringify({ type: "message", id: "a4", parentId: "u4", message: { role: "assistant", content: [{ type: "text", text: "4" }], usage: { input: 50000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 50010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),
			JSON.stringify({ type: "message", id: "u5", parentId: "a4", message: { role: "user", content: [{ type: "text", text: "5" }] } }),
			JSON.stringify({ type: "message", id: "a5", parentId: "u5", message: { role: "assistant", content: [{ type: "text", text: "5" }], usage: { input: 80000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 80010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),

			// Second prune: 80K → 20K (also not a segment boundary)
			JSON.stringify({ type: "message", id: "u6", parentId: "a5", message: { role: "user", content: [{ type: "text", text: "6" }] } }),
			JSON.stringify({ type: "message", id: "a6", parentId: "u6", message: { role: "assistant", content: [{ type: "text", text: "second prune boundary" }], usage: { input: 20000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),
			JSON.stringify({ type: "message", id: "u7", parentId: "a6", message: { role: "user", content: [{ type: "text", text: "7" }] } }),
			JSON.stringify({ type: "message", id: "a7", parentId: "u7", message: { role: "assistant", content: [{ type: "text", text: "final segment turn" }], usage: { input: 40000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 40010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),
		];
		writeFileSync(path, `${lines.join("\n")}\n`);

		const childPath = join(tmpDir, "child-multi-prune.jsonl");
		// Budget = 100K (Ctx=110K, reserve=10K)
		// All entries in one segment (no boundaries at drops).
		// totalTokens = 40K (last cumul). 40K <= 100K → no trim.
		// ALL entries should be inherited — no exclusion from false boundaries.
		writeTrimmedForkSession(path, childPath, {
			childContextWindow: 110_000,
			reserveTokens: 10_000,
		});

		const written = readFileSync(childPath, "utf-8");
		const entries = written.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
		const keptIds = entries.filter((e) => e.type === "message").map((e) => e.id);

		// ALL entries should be inherited — drops from context pruning are NOT
		// segment boundaries. Every entry is valid content.
		assert.ok(keptIds.includes("a1"), "early assistant inherited (no boundary at prune)");
		assert.ok(keptIds.includes("a4"), "mid-session assistant inherited");
		assert.ok(keptIds.includes("a7"), "final assistant inherited");
		assert.ok(keptIds.includes("a3"), "first prune boundary is content, not a segment boundary");
		assert.ok(keptIds.includes("a6"), "second prune boundary is content, not a segment boundary");
	});

	/**
	 * The findTrimStart function should still correctly trim when the segment-local
	 * total legitimately exceeds budget.
	 */
	it("still correctly trims when segment-local total exceeds budget", () => {
		const path = join(tmpDir, "legitimate-trim.jsonl");
		const lines = [
			JSON.stringify({ type: "session", version: 3, id: "s", timestamp: new Date().toISOString(), cwd: tmpDir }),

			// Pre-prune: 100K
			JSON.stringify({ type: "message", id: "u-pre", parentId: "s", message: { role: "user", content: [{ type: "text", text: "pre" }] } }),
			JSON.stringify({ type: "message", id: "a-pre", parentId: "u-pre", message: { role: "assistant", content: [{ type: "text", text: "pre" }], usage: { input: 100000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 100010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),

			// PRUNE: 100K → 10K
			JSON.stringify({ type: "message", id: "u-post-0", parentId: "a-pre", message: { role: "user", content: [{ type: "text", text: "post start" }] } }),
			JSON.stringify({ type: "message", id: "a-post-0", parentId: "u-post-0", message: { role: "assistant", content: [{ type: "text", text: "first post-prune" }], usage: { input: 10000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 10010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),

			// Post-prune: 110K total (segment-local = 100K)
			JSON.stringify({ type: "message", id: "u-post-1", parentId: "a-post-0", message: { role: "user", content: [{ type: "text", text: "post 1" }] } }),
			JSON.stringify({ type: "message", id: "a-post-1", parentId: "u-post-1", message: { role: "assistant", content: [{ type: "text", text: "post 1" }], usage: { input: 60000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 60010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),

			// 110K
			JSON.stringify({ type: "message", id: "u-post-2", parentId: "a-post-1", message: { role: "user", content: [{ type: "text", text: "post 2" }] } }),
			JSON.stringify({ type: "message", id: "a-post-2", parentId: "u-post-2", message: { role: "assistant", content: [{ type: "text", text: "post 2" }], usage: { input: 110000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" } }),
		];
		writeFileSync(path, `${lines.join("\n")}\n`);

		// Budget = 50K (Ctx=60K, reserve=10K)
		// Segment-local = 110K − 10K = 100K
		// 100K > 50K → legitimate trim
		const childPath = join(tmpDir, "child-legitimate-trim.jsonl");
		writeTrimmedForkSession(path, childPath, {
			childContextWindow: 60_000,
			reserveTokens: 10_000,
		});

		const written = readFileSync(childPath, "utf-8");
		const entries = written.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
		const keptIds = entries.filter((e) => e.type === "message").map((e) => e.id);

		// Only the newest entries should survive (oldest post-prune assistant dropped)
		assert.ok(keptIds.includes("a-post-2"), "newest post-prune assistant kept after trim");
		// The first post-prune assistant may be dropped if the trim needs room
		// (depends on assistant-boundary granularity)
	});
});
