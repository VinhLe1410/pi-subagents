#!/usr/bin/env node
/**
 * Live e2e test: mixed batch (subagent + bash) should terminate when
 * coordinator-only-turn is enabled and should NOT terminate when
 * PI_SUBAGENT_DISABLE_COORDINATOR_ONLY_TURN=1.
 *
 * This tests the shouldTerminateToolBatch fix in pi-agent-core:
 *   every() → some()  so that if ANY tool result has terminate: true,
 *   the batch terminates even when other tools (bash) don't set it.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { LIVE_TEST_MODEL } from "./live-test-guard.mjs";

const piBin = process.env.PI_E2E_PI_BIN ?? "pi";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const extensionSource = join(repoRoot, "src", "index.ts");
const tmpRoot = join(tmpdir(), `pi-subagents-live-mixed-batch-${process.pid}`);
const configDir = join(tmpRoot, "agent");
const workDir = join(tmpRoot, "work");
const agentsDir = join(workDir, ".pi", "agents");
const enabledSessionDir = join(tmpRoot, "enabled");
const disabledSessionDir = join(tmpRoot, "disabled");
const sourceConfigDir = join(homedir(), ".pi", "agent");
const keepTmp = process.env.PI_SUBAGENT_KEEP_E2E_TMP === "1";

mkdirSync(configDir, { recursive: true });
mkdirSync(agentsDir, { recursive: true });
mkdirSync(enabledSessionDir, { recursive: true });
mkdirSync(disabledSessionDir, { recursive: true });
for (const name of ["auth.json", "settings.json", "models.json", "mcp.json"]) {
  const source = join(sourceConfigDir, name);
  if (existsSync(source)) copyFileSync(source, join(configDir, name));
}

// Agent that completes quickly
writeFileSync(
  join(agentsDir, "mixed-test-agent.md"),
  `---\nname: mixed-test-agent\ndescription: Fast async child for mixed-batch live regression.\nthinking: off\nauto-exit: true\nmode: background\nasync: true\ntools: bash\n---\n\nReply exactly: MIXED_BATCH_CHILD_OK`,
  "utf8",
);

function listJsonlFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonlFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".jsonl")) files.push(fullPath);
  }
  return files;
}

function parseJsonl(file) {
  const events = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {}
  }
  return events;
}

function getUserText(events) {
  return events
    .filter((event) => event.type === "message" && event.message?.role === "user")
    .flatMap((event) => event.message.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function getAssistantTexts(events) {
  return events
    .filter((event) => event.type === "message" && event.message?.role === "assistant")
    .flatMap((event) => event.message.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim());
}

function getToolResults(events, toolName) {
  return events
    .filter(
      (event) =>
        event.type === "message" &&
        event.message?.role === "toolResult" &&
        event.message.toolName === toolName,
    )
    .map((event) => event.message);
}

function findParentSession(sessionDir, marker) {
  for (const file of listJsonlFiles(sessionDir)) {
    const events = parseJsonl(file);
    if (getUserText(events).includes(marker)) return { file, events };
  }
  throw new Error(`Could not find parent session for ${marker}.`);
}

function runPi(sessionDir, marker, extraEnv = {}) {
  execFileSync(
    piBin,
    [
      "-p",
      "--model",
      LIVE_TEST_MODEL,
      "--no-extensions",
      "-e",
      extensionSource,
      "--session-dir",
      sessionDir,
      // Single combined prompt: launch subagent AND run a bash command in the same turn.
      [
        marker,
        "Call subagent with name \"mixed-child\", agent \"mixed-test-agent\", title \"Mixed batch test\", task \"do the mixed batch test\".",
        "ALSO run: bash command 'echo MIXED_BATCH_BASH_OK'.",
        "Do BOTH in the same response — subagent AND bash.",
        'If you get a subagent result with "started" status, write exactly "MIXED_BATCH_DONE" and nothing else.',
        "Do not write anything else.",
      ].join("\n"),
    ],
    {
      cwd: workDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PI_PACKAGE_DIR: "",
        PI_CODING_AGENT_DIR: configDir,
        PI_SUBAGENT_DISABLE_AMBIENT_AWARENESS: "1",
        PI_SUBAGENT_AGENT: "",
        PI_SUBAGENT_NAME: "",
        PI_SUBAGENT_AUTO_EXIT: "",
        PI_DENY_TOOLS: "",
        PI_SUBAGENT_PI_COMMAND: piBin,
        PI_ARTIFACT_PROJECT_ROOT: "",
        PI_SUBAGENT_DISABLE_COORDINATOR_ONLY_TURN: extraEnv.DISABLE ?? "",
        ...extraEnv,
      },
    },
  );
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed++;
    return false;
  }
  console.log(`  ok: ${message}`);
  passed++;
  return true;
}

try {
  // ===============================================================
  // Test 1: Coordinator-only-turn ENABLED — mixed batch should terminate
  // ===============================================================
  const enabledMarker = "MIXED_BATCH_ENABLED_MARKER";
  runPi(enabledSessionDir, enabledMarker, {});

  const enabledSession = findParentSession(enabledSessionDir, enabledMarker);
  const enabledSubagentResults = getToolResults(enabledSession.events, "subagent");
  const enabledBashResults = getToolResults(enabledSession.events, "bash");

  assert(
    enabledSubagentResults.length === 1,
    `Expected 1 subagent result, got ${enabledSubagentResults.length}`,
  );
  assert(
    enabledBashResults.length === 1,
    `Expected 1 bash result, got ${enabledBashResults.length}`,
  );

  // With coordinator-only-turn enabled, the parent should NOT continue
  // after the mixed batch (the subagent result's terminate: true should
  // cause the batch to terminate even though bash doesn't have terminate).
  const enabledTexts = getAssistantTexts(enabledSession.events).join("\n");
  assert(
    !enabledTexts.includes("MIXED_BATCH_DONE"),
    "Parent should NOT continue after mixed batch, but assistant wrote continuation text",
  );

  console.log(`\n✓ mixed batch (enabled): batch terminated correctly (${LIVE_TEST_MODEL})`);

  // ===============================================================
  // Test 2: DISABLE_COORDINATOR_ONLY_TURN=1 — mixed batch should NOT terminate
  // ===============================================================
  const disabledMarker = "MIXED_BATCH_DISABLED_MARKER";
  runPi(disabledSessionDir, disabledMarker, { DISABLE: "1" });

  const disabledSession = findParentSession(disabledSessionDir, disabledMarker);
  const disabledSubagentResults = getToolResults(disabledSession.events, "subagent");
  const disabledBashResults = getToolResults(disabledSession.events, "bash");

  assert(
    disabledSubagentResults.length === 1,
    `Expected 1 subagent result, got ${disabledSubagentResults.length}`,
  );
  assert(
    disabledBashResults.length === 1,
    `Expected 1 bash result, got ${disabledBashResults.length}`,
  );

  // With coordinator-only-turn disabled, the parent SHOULD continue
  // (no terminate flag set anywhere).
  const disabledTexts = getAssistantTexts(disabledSession.events).join("\n");
  assert(
    disabledTexts.includes("MIXED_BATCH_DONE"),
    "Parent should continue after mixed batch when coordinator-only-turn is disabled, but no continuation text found",
  );

  console.log(`\n✓ mixed batch (disabled): continuation verified (${LIVE_TEST_MODEL})`);
} finally {
  if (!keepTmp) {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
