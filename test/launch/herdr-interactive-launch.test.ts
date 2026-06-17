import {
	ASSISTANT_MSG,
	MODEL_CHANGE,
	SESSION_HEADER,
	USER_MSG,
	assert,
	createSessionFile,
	createTestDir,
	describe,
	existsSync,
	it,
	join,
	mkdirSync,
	readFileSync,
	readSubagentLaunchMetadataForTest,
	sleep,
	writeExecutable,
	writeFileSync,
} from "../support/index.ts";
import { launchBackgroundSubagent } from "../../src/launch/background.ts";
import { launchInteractiveSubagent } from "../../src/launch/interactive.ts";

function clearMuxRuntimeEnv(): void {
	delete process.env.CMUX_SOCKET_PATH;
	delete process.env.CMUX_SURFACE_ID;
	delete process.env.TMUX;
	delete process.env.TMUX_PANE;
	delete process.env.WEZTERM_PANE;
	delete process.env.WEZTERM_UNIX_SOCKET;
	delete process.env.ZELLIJ;
	delete process.env.ZELLIJ_SESSION_NAME;
	delete process.env.HERDR_PANE_ID;
	delete process.env.HERDR_TAB_ID;
	delete process.env.HERDR_WORKSPACE_ID;
	delete process.env.PI_SUBAGENT_MUX;
	delete process.env.PI_SUBAGENT_PI_COMMAND;
}

function writeFakeHerdr(dir: string): string {
	const logFile = join(dir, "herdr.log");
	writeFileSync(logFile, "");
	writeExecutable(
		dir,
		"herdr",
		`#!/bin/sh
printf '%s\n' "$*" >> "${logFile}"

if [ "$*" = "status server --json" ]; then
  printf '%s\n' '{"status":"running","running":true,"compatible":true,"protocol":14,"version":"0.7.0"}'
  exit 0
fi

if [ "$*" = "pane current --current" ]; then
  printf '%s\n' '{"id":"cli:pane:current","result":{"type":"pane_current","pane":{"pane_id":"w1:p1","tab_id":"w1:t1","workspace_id":"w1","cwd":"/parent","foreground_cwd":"/parent","focused":true}}}'
  exit 0
fi

if [ "$1" = "tab" ] && [ "$2" = "create" ]; then
  printf '%s\n' '{"id":"cli:tab:create","result":{"type":"tab_created","tab":{"tab_id":"w1:t2","workspace_id":"w1","label":"Child","focused":false,"pane_count":1},"pane":{"pane_id":"w1:p2","tab_id":"w1:t2","workspace_id":"w1","cwd":"/child","focused":false}}}'
  exit 0
fi

if [ "$1" = "pane" ] && [ "$2" = "send-text" ]; then
  printf '%s\n' '{"id":"cli:pane:send-text","result":{"type":"pane_sent_text"}}'
  exit 0
fi

printf '%s\n' '{"error":{"code":"unknown_command","message":"unsupported fake herdr command"}}'
exit 1
`,
	);
	return logFile;
}

function useFakeHerdr(): { dir: string; logFile: string } {
	const dir = createTestDir();
	const logFile = writeFakeHerdr(dir);
	clearMuxRuntimeEnv();
	process.env.PATH = dir;
	return { dir, logFile };
}

function writeParentSession(dir: string): string {
	return createSessionFile(dir, [
		SESSION_HEADER,
		MODEL_CHANGE,
		USER_MSG,
		ASSISTANT_MSG,
	]);
}

async function readEventually(path: string): Promise<string> {
	for (let attempt = 0; attempt < 50; attempt++) {
		if (existsSync(path)) {
			const text = readFileSync(path, "utf8");
			if (text.trim()) return text;
		}
		await sleep(10);
	}
	throw new Error(`Timed out waiting for ${path}`);
}

describe("Herdr interactive launch parity", () => {
	it("launches interactive Herdr children with resolved cwd, session, approval, and surface facts", async () => {
		const { logFile } = useFakeHerdr();
		const cwd = createTestDir();
		process.env.PI_ARTIFACT_PROJECT_ROOT = join(cwd, "artifacts");
		const childCwd = join(cwd, "child-workspace");
		mkdirSync(childCwd, { recursive: true });
		mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "agents", "path-session.md"),
			[
				"---",
				"name: path-session",
				"session-mode: fork",
				"no-session: true",
				"trust-project: true",
				"cwd: child-workspace",
				"env: |",
				"  CUSTOM_ENV=from-agent",
				"flags: --alpha 'two words'",
				"---",
				"Preserve resolved runtime facts.",
			].join("\n"),
		);
		const parentSession = writeParentSession(cwd);
		const waitedSurfaces: string[] = [];

		const running = await launchInteractiveSubagent(
			{
				name: "path-session-child",
				title: "Path session child",
				task: "Check launch parity.",
				agent: "path-session",
			},
			{
				cwd,
				sessionManager: {
					getSessionFile: () => parentSession,
					getSessionId: () => "parent-session-id",
					getLeafId: () => "asst-001",
				},
			},
			{
				getContextWindow: () => 4096,
				getShellReadyDelayMs: () => 0,
				waitForInteractivePrompt: async (surface) => {
					waitedSurfaces.push(surface);
				},
			},
		);

		assert.equal(running.mode, "interactive");
		assert.equal(running.surface, "w1:p2");
		assert.equal(running.noSession, true);
		assert.equal(running.modelContextWindow, 4096);
		assert.deepEqual(waitedSurfaces, ["w1:p2"]);

		const metadata = readSubagentLaunchMetadataForTest(running.sessionFile);
		assert.equal(metadata?.mode, "interactive");
		assert.equal(metadata?.sessionMode, "fork");
		assert.equal(metadata?.noSession, true);
		assert.equal(metadata?.trustProject, true);
		assert.equal(metadata?.cwd, childCwd);
		assert.equal(metadata?.env, "CUSTOM_ENV=from-agent");
		assert.equal(metadata?.flags, "--alpha 'two words'");

		const log = readFileSync(logFile, "utf8");
		assert.match(log, /status server --json/);
		assert.match(log, /pane current --current/);
		assert.match(log, /tab create --workspace w1 --cwd .* --label path-session-child --no-focus/);
		assert.match(log, /pane send-text w1:p2 /);
		assert.match(log, new RegExp(`cd '${childCwd.replace(/'/g, "'\\''")}' &&`));
		assert.match(log, new RegExp(`'--session' '${running.sessionFile.replace(/'/g, "'\\''")}'`));
		assert.match(log, /'--no-session'/);
		assert.match(log, /'--approve'/);
		assert.match(log, /CUSTOM_ENV='from-agent'/);
		assert.match(log, /PI_SUBAGENT_SURFACE='w1:p2'/);
		assert.match(log, /'--alpha' 'two words'/);
	});

	it("keeps background launches independent of Herdr mux availability", async () => {
		const { dir, logFile: herdrLogFile } = useFakeHerdr();
		const cwd = createTestDir();
		process.env.PI_ARTIFACT_PROJECT_ROOT = join(cwd, "artifacts");
		const childCwd = join(cwd, "background-workspace");
		mkdirSync(childCwd, { recursive: true });
		mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "agents", "bg-agent.md"),
			[
				"---",
				"name: bg-agent",
				"session-mode: lineage-only",
				"trust-project: true",
				"cwd: background-workspace",
				"env: |",
				"  CUSTOM_ENV=from-background-agent",
				"flags: --background-flag",
				"---",
				"Run in the background.",
			].join("\n"),
		);
		const parentSession = writeParentSession(cwd);
		const childLogFile = join(cwd, "background-child.log");
		const fakePi = writeExecutable(
			dir,
			"fake-pi",
			`#!/bin/sh
{
  printf 'PWD=%s\n' "$PWD"
  printf 'ARGS=%s\n' "$*"
  printf 'CUSTOM_ENV=%s\n' "\${CUSTOM_ENV-}"
  printf 'SURFACE=%s\n' "\${PI_SUBAGENT_SURFACE-}"
} >> "${childLogFile}"
`,
		);
		process.env.PI_SUBAGENT_PI_COMMAND = fakePi;

		const running = await launchBackgroundSubagent(
			{
				name: "background-child",
				title: "Background child",
				task: "Check background launch isolation.",
				agent: "bg-agent",
			},
			{
				cwd,
				sessionManager: {
					getSessionFile: () => parentSession,
					getSessionId: () => "parent-session-id",
					getLeafId: () => "asst-001",
				},
			},
			{ getContextWindow: () => 2048 },
		);

		const childLog = await readEventually(childLogFile);
		assert.equal(running.mode, "background");
		assert.equal(running.surface, undefined);
		assert.equal(running.modelContextWindow, 2048);
		assert.match(childLog, new RegExp(`PWD=${childCwd.replace(/'/g, "'\\''")}`));
		assert.match(childLog, /CUSTOM_ENV=from-background-agent/);
		assert.match(childLog, /SURFACE=\n/);
		assert.match(childLog, /--no-approve/);
		assert.match(childLog, /--background-flag/);
		assert.equal(readFileSync(herdrLogFile, "utf8"), "");
	});
});
