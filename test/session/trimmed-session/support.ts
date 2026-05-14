import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { writeTrimmedForkSession } from "../../../src/session/trimmed-session.ts";

/**
 * Assert that forked output has properly neutralized tool call metadata.
 *
 * After fork trimming, all entries go through serializeEntry which:
 * - Converts toolCall/toolUse content blocks to `[tool call: name]` text
 * - Converts toolResult role messages to user role, stripping toolCallId
 *
 * No entry should have raw toolCall blocks or toolResult role after
 * serializeEntry processes it.
 */
function assertNeutralizedToolMetadata(entries: any[]): void {
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		// No raw toolCall/toolUse blocks should survive
		if (message?.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (typeof block === "object" && block !== null) {
					assert.notEqual(
						block.type, "toolCall",
						"forked assistant entries must not carry raw toolCall blocks",
					);
					assert.notEqual(
						block.type, "toolUse",
						"forked assistant entries must not carry raw toolUse blocks",
					);
				}
			}
		}
		// No toolResult role should survive (converted to user)
		assert.notEqual(
			message?.role, "toolResult",
			"forked entries must not carry toolResult role",
		);
		// No toolCallId should survive
		if (message?.toolCallId !== undefined) {
			assert.fail(`forked entries must not carry toolCallId (found on ${message.role || '?'})`);
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
	assertNeutralizedToolMetadata,
	createMinimalSession,
};
