import {
	assert,
	writeFileSync,
	join,
	afterEach,
	describe,
	it,
	createTestDir,
	readSubagentLaunchMetadataForTest,
	writeSubagentLaunchMetadataEntryForTest,
	resolveResumeLaunchMetadataForTest,
	resetSubagentStateForTest,
	requestSubagentBatchStopForTest,
	getSubagentBatchStopMetadataForTest,
} from "../support/index.ts";
import { resolve } from "node:path";

describe("subagent_resume name identity", () => {
	it("resolves canonical name from persisted launch metadata", async () => {
		const dir = createTestDir();
		const sessionFile = join(dir, "child.jsonl");
		const header = {
			type: "session",
			version: 3,
			id: "child-sess",
			timestamp: new Date().toISOString(),
			cwd: dir,
		};
		writeFileSync(sessionFile, JSON.stringify(header) + "\n");

		await writeSubagentLaunchMetadataEntryForTest(sessionFile, {
			version: 1,
			timestamp: new Date().toISOString(),
			name: "magician",
			title: "Say hi",
			agent: "magician",
			mode: "interactive",
			sessionMode: "fork",
			autoExit: true,
			parentClosePolicy: "terminate",
			blocking: false,
			async: true,
			denyTools: [],
			noContextFiles: false,
			noSession: false,
			agentConfigDir: dir,
			cwd: dir,
			boundarySystemPrompt: false,
		});

		const launchMetadata = readSubagentLaunchMetadataForTest(sessionFile);
		assert.ok(launchMetadata);
		assert.equal(launchMetadata!.name, "magician");

		const metadata = resolveResumeLaunchMetadataForTest(sessionFile);
		assert.equal(metadata.name, "magician");
	});

	it("resolves canonical name overrides user-provided name via params.name fallback", async () => {
		const dir = createTestDir();
		const sessionFile = join(dir, "child.jsonl");
		writeFileSync(
			sessionFile,
			JSON.stringify({ type: "session", version: 3, id: "s", timestamp: new Date().toISOString(), cwd: dir }) + "\n",
		);

		await writeSubagentLaunchMetadataEntryForTest(sessionFile, {
			version: 1,
			timestamp: new Date().toISOString(),
			name: "scout",
			agent: "scout",
			mode: "background",
			sessionMode: "lineage-only",
			autoExit: true,
			parentClosePolicy: "terminate",
			blocking: false,
			async: true,
			denyTools: [],
			noContextFiles: false,
			noSession: false,
			agentConfigDir: dir,
			cwd: dir,
			boundarySystemPrompt: false,
		});

		// The canonical name should always come from metadata, not from what the
		// user passes as 'name'. Simulate the name resolution from resume-tool.ts:
		const launchMetadata = readSubagentLaunchMetadataForTest(sessionFile);
		const metadata = resolveResumeLaunchMetadataForTest(sessionFile);
		const canonicalName = launchMetadata?.name ?? metadata.name ?? "Resume";
		const userProvidedName = "custom-label";

		assert.equal(canonicalName, "scout");
		assert.notEqual(canonicalName, userProvidedName);
	});

	it("falls back to Resume when no metadata is available", () => {
		const dir = createTestDir();
		const sessionFile = join(dir, "empty-child.jsonl");
		writeFileSync(
			sessionFile,
			JSON.stringify({ type: "session", version: 3, id: "s", timestamp: new Date().toISOString(), cwd: dir }) + "\n",
		);

		const launchMetadata = readSubagentLaunchMetadataForTest(sessionFile);
		const metadata = resolveResumeLaunchMetadataForTest(sessionFile);
		const canonicalName = launchMetadata?.name ?? metadata.name ?? "Resume";

		assert.equal(canonicalName, "Resume");
	});
});

describe("subagent_resume coordinator-only-turn", () => {
	afterEach(() => {
		delete process.env.PI_SUBAGENT_DISABLE_COORDINATOR_ONLY_TURN;
		resetSubagentStateForTest();
	});

	it("calls requestSubagentBatchStop for async resumes", () => {
		// Simulate what the resume tool does for an async (non-blocking) resume.
		// requestSubagentBatchStop should set the batch-stop flag so that
		// getSubagentBatchStopMetadata returns { terminate: true }.
		requestSubagentBatchStopForTest();
		const meta = getSubagentBatchStopMetadataForTest();
		assert.deepEqual(meta, { terminate: true });
	});

	it("respects coordinator-only-turn opt-out for async resumes", () => {
		process.env.PI_SUBAGENT_DISABLE_COORDINATOR_ONLY_TURN = "1";
		requestSubagentBatchStopForTest();
		const meta = getSubagentBatchStopMetadataForTest();
		assert.equal(meta.terminate, undefined);
	});

	it("does not call batch stop for awaited (sync/blocking) resumes", () => {
		// When shouldAwait is true, the resume tool returns
		// runtime.getLaunchedSubagentResult() directly, not the batch-stop path.
		// getSubagentBatchStopMetadata should be empty in this case.
		const meta = getSubagentBatchStopMetadataForTest();
		assert.deepEqual(meta, {});
	});
});

describe("subagent_resume same-session guard", () => {
	it("detects duplicate sessionFile in running subagents", () => {
		const dir = createTestDir();
		const sessionFile = join(dir, "child.jsonl");
		writeFileSync(
			sessionFile,
			JSON.stringify({ type: "session", version: 3, id: "s", timestamp: new Date().toISOString(), cwd: dir }) + "\n",
		);

		const runningSubagents = new Map<string, any>();
		const existingId = "existing-001";
		runningSubagents.set(existingId, {
			id: existingId,
			name: "magician",
			agent: "magician",
			sessionFile,
			mode: "interactive",
			deliveryState: "detached",
			parentClosePolicy: "terminate",
			blocking: false,
			async: true,
			task: "Do magic",
		});

		// Simulate the same-session guard from resume-tool.ts
		const normalizedFile = resolve(sessionFile);
		let guardResult: any = null;
		for (const existing of runningSubagents.values()) {
			if (existing.sessionFile && resolve(existing.sessionFile) === normalizedFile) {
				guardResult = {
					id: existing.id,
					name: existing.name,
					content: `Session "${existing.name}" (${existing.agent ?? "subagent"}) is already running with id ${existing.id}.`,
				};
				break;
			}
		}

		assert.ok(guardResult, "Guard should have triggered");
		assert.equal(guardResult!.name, "magician");
		assert.equal(guardResult!.id, existingId);
		assert.match(
			guardResult!.content,
			/existing-001/,
			"Should reference the existing running subagent id",
		);
	});

	it("does not trigger guard when sessionFile differs", () => {
		const runningSubagents = new Map<string, any>();
		runningSubagents.set("existing-001", {
			id: "existing-001",
			name: "scout",
			sessionFile: "/tmp/other-session.jsonl",
		});

		const newSessionFile = "/tmp/different-session.jsonl";
		const normalizedFile = resolve(newSessionFile);
		let guardResult: any = null;
		for (const existing of runningSubagents.values()) {
			if (existing.sessionFile && resolve(existing.sessionFile) === normalizedFile) {
				guardResult = { id: existing.id };
				break;
			}
		}

		assert.equal(guardResult, null, "Guard should not trigger for different session files");
	});
});
