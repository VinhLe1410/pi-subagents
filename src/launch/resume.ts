import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ParentClosePolicy } from "../types.ts";
import { getEntries } from "../session/session.ts";
import {
	readSubagentLaunchMetadata,
	type PersistedSubagentLaunchMetadata,
} from "../session/session-files.ts";
import { shellEscape } from "./child-command.ts";

export type ResumeMode = "interactive" | "background";
type ResumeModeSource = "metadata" | "fallback";

export interface ResumeLaunchMetadata {
	mode: ResumeMode;
	modeSource: ResumeModeSource;
	agent?: string;
	name?: string;
	autoExit?: boolean;
	parentClosePolicy?: ParentClosePolicy;
	blocking?: boolean;
	async?: boolean;
}

function normalizeSessionFilePath(file: string): string {
	try {
		return resolve(file);
	} catch {
		return file;
	}
}

function sameSessionFile(left: unknown, right: string): boolean {
	return (
		typeof left === "string" &&
		normalizeSessionFilePath(left) === normalizeSessionFilePath(right)
	);
}

export function getResumeCwd(
	metadata: PersistedSubagentLaunchMetadata | undefined,
): string | undefined {
	return metadata?.cwd || undefined;
}

export function buildShellChangeDirectoryPrefix(cwd: string | undefined): string {
	return cwd ? `cd ${shellEscape(cwd)} && ` : "";
}

function findLaunchMetadataInValue(
	value: unknown,
	sessionFile: string,
): Omit<ResumeLaunchMetadata, "modeSource"> | null {
	if (!value || typeof value !== "object") return null;
	const stack: unknown[] = [value];
	const seen = new Set<object>();
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current || typeof current !== "object") continue;
		if (seen.has(current)) continue;
		seen.add(current);
		const record = current as Record<string, unknown>;
		if (sameSessionFile(record.sessionFile, sessionFile)) {
			return {
				mode: "background",
				agent: typeof record.agent === "string" ? record.agent : undefined,
				name: typeof record.name === "string" ? record.name : undefined,
				autoExit:
					typeof record.autoExit === "boolean" ? record.autoExit : undefined,
				parentClosePolicy:
					record.parentClosePolicy === "terminate" ||
					record.parentClosePolicy === "continue"
						? record.parentClosePolicy
						: undefined,
				blocking: true,
				async: false,
			};
		}
		for (const child of Object.values(record)) {
			if (child && typeof child === "object") stack.push(child);
		}
	}
	return null;
}

function getParentSessionFileFromChildSession(
	sessionFile: string,
): string | null {
	try {
		for (const entry of getEntries(sessionFile)) {
			const parentSession = (entry as Record<string, unknown>).parentSession;
			if (typeof parentSession === "string" && parentSession)
				return parentSession;
		}
	} catch {}
	return null;
}

export function resolveResumeLaunchMetadata(
	sessionFile: string,
	_explicitMode?: ResumeMode,
): ResumeLaunchMetadata {
	const launchMetadata = readSubagentLaunchMetadata(sessionFile);
	if (launchMetadata) {
		return {
			mode: "background",
			modeSource: "metadata",
			agent: launchMetadata.agent,
			name: launchMetadata.name,
			autoExit: launchMetadata.autoExit,
			parentClosePolicy: launchMetadata.parentClosePolicy,
			blocking: true,
			async: false,
		};
	}
	try {
		for (const entry of getEntries(sessionFile)) {
			const direct = findLaunchMetadataInValue(entry, sessionFile);
			if (direct) return { ...direct, modeSource: "metadata" };
		}
	} catch {}

	const parentSession = getParentSessionFileFromChildSession(sessionFile);
	if (parentSession && existsSync(parentSession)) {
		try {
			for (const entry of getEntries(parentSession)) {
				const parentMetadata = findLaunchMetadataInValue(entry, sessionFile);
				if (parentMetadata)
					return { ...parentMetadata, modeSource: "metadata" };
			}
		} catch {}
	}

	// Persisted/call-time mode is obsolete compatibility data. Resume always
	// launches as a background process and waits for completion.
	return { mode: "background", modeSource: "fallback" };
}

export function buildResumePiArgs(
	sessionFile: string,
	_mode: ResumeMode = "background",
): string[] {
	return ["-p", "--session", sessionFile];
}
