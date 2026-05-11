import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { writeTrimmedForkSession } from "../../../src/session/trimmed-session.ts";

/**
 * Helper: create a minimal session JSONL file with one user message and one assistant message.
 */
function assertToolResultsHavePriorToolCalls(entries: any[]): void {
	const seenToolCalls = new Set<string>();
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message?.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (block?.type === "toolCall" && typeof block.id === "string") {
					seenToolCalls.add(block.id);
				}
			}
		}
		if (message?.role === "toolResult") {
			assert.equal(
				typeof message.toolCallId,
				"string",
				"toolResult must preserve string toolCallId",
			);
			assert.ok(
				seenToolCalls.has(message.toolCallId),
				`toolResult ${message.toolCallId} must match an earlier assistant toolCall`,
			);
		}
	}
}

function createMinimalSession(dir: string, filename = "source.jsonl"): string {
	const path = join(dir, filename);
	const lines = [
		JSON.stringify({
			type: "session",
			version: 3,
			id: "sess-1",
			timestamp: "2026-01-01T00:00:00.000Z",
			cwd: dir,
		}),
		JSON.stringify({
			type: "message",
			id: "msg-1",
			parentId: "sess-1",
			timestamp: "2026-01-01T00:00:01.000Z",
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
			timestamp: "2026-01-01T00:00:02.000Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Hi there!" }],
				timestamp: Date.now(),
				usage: {
					input: 100,
					output: 10,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 110,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
			},
		}),
	];
	writeFileSync(path, `${lines.join("\n")}\n`, "utf-8");
	return path;
}


export {
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
	assertToolResultsHavePriorToolCalls,
	createMinimalSession,
};
