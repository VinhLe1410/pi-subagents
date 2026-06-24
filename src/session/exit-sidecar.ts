import { existsSync, readFileSync, rmSync } from "node:fs";

export interface SubagentExitSignal {
	reason: "done" | "error";
	exitCode: number;
	outputTokens?: number;
	errorMessage?: string;
}

export function getSubagentExitSidecarPath(sessionFile: string): string {
	return `${sessionFile}.exit`;
}

export function clearSubagentExitSidecar(sessionFile: string): void {
	rmSync(getSubagentExitSidecarPath(sessionFile), { force: true });
}

function withDefinedTokens(
	obj: SubagentExitSignal,
	tokens: number | undefined,
): SubagentExitSignal {
	if (tokens !== undefined) obj.outputTokens = tokens;
	return obj;
}

function interpretExitSidecar(data: unknown): SubagentExitSignal {
	const record = data as Record<string, unknown> | null;
	const tokens = typeof record?.outputTokens === "number" ? record.outputTokens : undefined;
	if (record?.type === "error") {
		const errorMessage =
			typeof record.errorMessage === "string" && record.errorMessage.trim() !== ""
				? record.errorMessage
				: "Subagent exited with stopReason=error (no errorMessage in sidecar).";
		return withDefinedTokens({ reason: "error", exitCode: 1, errorMessage }, tokens);
	}
	return withDefinedTokens({ reason: "done", exitCode: 0 }, tokens);
}

export function consumeSubagentExitSignal(sessionFile: string): SubagentExitSignal | null {
	const exitFile = getSubagentExitSidecarPath(sessionFile);
	if (!existsSync(exitFile)) return null;
	try {
		const parsed = JSON.parse(readFileSync(exitFile, "utf8"));
		if (!parsed || typeof parsed !== "object") return null;
		clearSubagentExitSidecar(sessionFile);
		return interpretExitSidecar(parsed);
	} catch {
		return null;
	}
}
