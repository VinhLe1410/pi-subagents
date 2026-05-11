import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getSessionArtifactDir } from "../artifact-storage.ts";

interface ArtifactContext {
	sessionManager: { getSessionId(): string };
	cwd: string;
}

function getArtifactDir(cwd: string, sessionId: string): string {
	return getSessionArtifactDir(cwd, sessionId);
}

function getSubagentArtifactPath(
	name: string,
	ctx: ArtifactContext,
	suffix = "",
): string {
	const sessionId = ctx.sessionManager.getSessionId();
	const artifactDir = getArtifactDir(ctx.cwd, sessionId);
	const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const safeName = name
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return join(
		artifactDir,
		`context/${safeName || "subagent"}${suffix ? `-${suffix}` : ""}-${ts}.md`,
	);
}

export function writeTaskArtifact(
	name: string,
	task: string,
	ctx: ArtifactContext,
): string {
	const artifactPath = getSubagentArtifactPath(name, ctx);
	mkdirSync(dirname(artifactPath), { recursive: true });
	writeFileSync(artifactPath, task, "utf8");
	return artifactPath;
}

export function writeSystemPromptArtifact(
	name: string,
	systemPrompt: string,
	ctx: ArtifactContext,
): string {
	const artifactPath = getSubagentArtifactPath(name, ctx, "sysprompt");
	mkdirSync(dirname(artifactPath), { recursive: true });
	writeFileSync(artifactPath, systemPrompt, "utf8");
	return artifactPath;
}
