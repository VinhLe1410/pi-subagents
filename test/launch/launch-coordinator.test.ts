import { homedir } from "node:os";
import {
	SESSION_HEADER,
	assert,
	createTestDir,
	describe,
	getEntries,
	it,
	join,
	mkdirSync,
	writeFileSync,
} from "../support/index.ts";
import { coordinateSubagentLaunch } from "../../src/launch/launch-coordinator.ts";

describe("launch coordinator", () => {
	it("prepares, seeds, persists, and returns simplified launch facts", async () => {
		const cwd = createTestDir();
		mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "agents", "scout.md"),
			[
				"---",
				"name: scout",
				"model: provider/model",
				"thinking: high",
				"tools: read,bash",
				"extensions: ./extensions/foo.ts, ~/.pi/agent/extensions/random-skill-i-wrote",
				"---",
				"You scout the codebase.",
			].join("\n"),
		);
		const parentSession = join(cwd, "parent.jsonl");
		writeFileSync(parentSession, `${JSON.stringify(SESSION_HEADER)}\n`);

		const launch = await coordinateSubagentLaunch(
			{
				name: "code-scout",
				title: "Code scout",
				task: "Map launch code",
				agent: "scout",
			},
			{
				cwd,
				sessionManager: {
					getSessionFile: () => parentSession,
					getSessionId: () => "parent-session-id",
					getLeafId: () => null,
				},
			},
			{ mode: "background" },
		);

		assert.equal(launch.sessionMode, "lineage-only");
		assert.equal(launch.noSession, false);
		assert.equal(launch.directTask, false);
		assert.equal(launch.seedMode, "lineage-only");
		assert.equal(launch.boundarySystemPrompt, false);
		assert.equal(launch.launchMetadata.mode, "background");
		assert.equal(launch.launchMetadata.sessionMode, "lineage-only");
		assert.equal(launch.launchMetadata.modelRef, "provider/model:high");
		assert.equal(launch.launchMetadata.trustProject, false);
		assert.equal(launch.launchMetadata.noContextFiles, true);
		assert.equal(launch.launchMetadata.noSession, false);
		assert.deepEqual(launch.launchMetadata.extensions, [
			join(cwd, ".pi", "agents", "extensions", "foo.ts"),
			join(homedir(), ".pi", "agent", "extensions", "random-skill-i-wrote"),
		]);
		assert.equal(launch.envVars.PI_SUBAGENT_SESSION, launch.prepared.subagentSessionFile);
		assert.equal(launch.envVars.PI_SUBAGENT_AUTO_EXIT, "1");
		assert.deepEqual(launch.envVars.PI_DENY_TOOLS.split(",").sort(), ["subagent"]);
		assert.equal(
			launch.envVars.PI_SUBAGENT_EXTENSIONS,
			[
				join(cwd, ".pi", "agents", "extensions", "foo.ts"),
				join(homedir(), ".pi", "agent", "extensions", "random-skill-i-wrote"),
			].join(","),
		);

		const entries = getEntries(launch.prepared.subagentSessionFile) as Array<Record<string, unknown>>;
		assert.equal(entries[0].type, "session");
		assert.equal(entries.some((entry) => entry.customType === "subagent_boundary"), false);
		assert.equal(entries.some((entry) => entry.type === "model_change"), false);
		assert.equal(entries.some((entry) => entry.type === "thinking_level_change"), false);
		assert.equal(entries.some((entry) => entry.customType === "pi-subagents_launch_metadata"), true);
		assert.equal(launch.launchEntryCount, entries.length);
	});

	it("treats an empty extensions row like no user extensions", async () => {
		const cwd = createTestDir();
		mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "agents", "empty-ext.md"),
			[
				"---",
				"name: empty-ext",
				"extensions:",
				"---",
				"Empty extension allowlist.",
			].join("\n"),
		);
		const parentSession = join(cwd, "parent-empty-ext.jsonl");
		writeFileSync(parentSession, `${JSON.stringify(SESSION_HEADER)}\n`);

		const launch = await coordinateSubagentLaunch(
			{
				name: "empty-ext-agent",
				title: "Empty extensions",
				task: "Launch empty extension allowlist",
				agent: "empty-ext",
			},
			{
				cwd,
				sessionManager: {
					getSessionFile: () => parentSession,
					getSessionId: () => "parent-session-id",
					getLeafId: () => null,
				},
			},
			{ mode: "background" },
		);

		assert.deepEqual(launch.launchMetadata.extensions, []);
	});

	it("rejects deprecated agent frontmatter fields", async () => {
		const cwd = createTestDir();
		mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "agents", "legacy.md"),
			[
				"---",
				"name: legacy",
				"session-mode: fork",
				"auto-exit: false",
				"---",
				"Legacy agent.",
			].join("\n"),
		);
		const parentSession = join(cwd, "parent.jsonl");
		writeFileSync(parentSession, `${JSON.stringify(SESSION_HEADER)}\n`);

		await assert.rejects(
			coordinateSubagentLaunch(
				{
					name: "legacy-agent",
					title: "Legacy agent",
					task: "Launch legacy",
					agent: "legacy",
				},
				{
					cwd,
					sessionManager: {
						getSessionFile: () => parentSession,
						getSessionId: () => "parent-session-id",
						getLeafId: () => null,
					},
				},
				{ mode: "background" },
			),
			/Unsupported agent frontmatter fields.*session-mode, auto-exit/,
		);
	});

	it("rejects invalid supported frontmatter values", async () => {
		const cwd = createTestDir();
		mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "agents", "invalid.md"),
			[
				"---",
				"name: invalid",
				"system-prompt: merge",
				"timeout: soon",
				"---",
				"Invalid agent.",
			].join("\n"),
		);
		const parentSession = join(cwd, "parent.jsonl");
		writeFileSync(parentSession, `${JSON.stringify(SESSION_HEADER)}\n`);

		await assert.rejects(
			coordinateSubagentLaunch(
				{
					name: "invalid-agent",
					title: "Invalid agent",
					task: "Launch invalid",
					agent: "invalid",
				},
				{
					cwd,
					sessionManager: {
						getSessionFile: () => parentSession,
						getSessionId: () => "parent-session-id",
						getLeafId: () => null,
					},
				},
				{ mode: "background" },
			),
			/Invalid system-prompt.*expected "append" or "replace"/,
		);
	});

	it("persists identity system prompt without changing the child session path", async () => {
		const cwd = createTestDir();
		mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "agents", "reviewer.md"),
			[
				"---",
				"name: reviewer",
				"system-prompt: append",
				"---",
				"You are the reviewer identity.",
			].join("\n"),
		);
		const parentSession = join(cwd, "parent-system-prompt.jsonl");
		writeFileSync(parentSession, `${JSON.stringify(SESSION_HEADER)}\n`);

		const launch = await coordinateSubagentLaunch(
			{
				name: "diff-reviewer",
				title: "Diff reviewer",
				task: "Review the diff",
				agent: "reviewer",
			},
			{
				cwd,
				sessionManager: {
					getSessionFile: () => parentSession,
					getSessionId: () => "parent-session-id",
					getLeafId: () => null,
				},
			},
			{ mode: "background" },
		);

		assert.equal(launch.systemPrompt?.flag, "--append-system-prompt");
		assert.equal(launch.systemPrompt?.text, "You are the reviewer identity.");
		assert.equal(launch.launchMetadata.systemPrompt, launch.systemPrompt?.text);
		assert.equal(launch.envVars.PI_SUBAGENT_SESSION, launch.prepared.subagentSessionFile);

		const metadataEntries = (getEntries(launch.prepared.subagentSessionFile) as Array<Record<string, unknown>>)
			.filter((entry) => entry.customType === "pi-subagents_launch_metadata");
		assert.equal(metadataEntries.length, 1);
	});
});
