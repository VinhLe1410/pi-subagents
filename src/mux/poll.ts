import { existsSync, readFileSync, rmSync } from "node:fs";
import { readScreenAsync } from "./io.ts";

export interface PollResult {
	reason: "done" | "ping" | "sentinel";
	exitCode: number;
	outputTokens?: number;
	ping?: { name: string; message: string };
}

export function consumeSubagentExitSignal(sessionFile: string): PollResult | null {
	const exitFile = `${sessionFile}.exit`;
	if (!existsSync(exitFile)) return null;

	try {
		const parsed = JSON.parse(readFileSync(exitFile, "utf8"));
		if (parsed?.type === "ping") {
			rmSync(exitFile, { force: true });
			return {
				reason: "ping",
				exitCode: 0,
				outputTokens:
					typeof parsed.outputTokens === "number"
						? parsed.outputTokens
						: undefined,
				ping: {
					name: parsed.name ?? "subagent",
					message: parsed.message ?? "",
				},
			};
		}
		if (parsed?.type === "done") {
			rmSync(exitFile, { force: true });
			return {
				reason: "done",
				exitCode: 0,
				outputTokens:
					typeof parsed.outputTokens === "number"
						? parsed.outputTokens
						: undefined,
			};
		}
	} catch {}

	return null;
}

async function waitForNextPoll(interval: number, signal: AbortSignal) {
	await new Promise<void>((resolve, reject) => {
		if (signal.aborted) return reject(new Error("Aborted"));
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, interval);
		function onAbort() {
			clearTimeout(timer);
			reject(new Error("Aborted"));
		}
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function readDoneSentinel(doneSentinelFile: string): PollResult | null {
	if (!existsSync(doneSentinelFile)) return null;
	const fileText = readFileSync(doneSentinelFile, "utf8");
	const fileMatch = fileText.match(/__SUBAGENT_DONE_(\d+)__/);
	return fileMatch
		? { reason: "sentinel", exitCode: parseInt(fileMatch[1], 10) }
		: null;
}

export async function pollForExit(
	surface: string,
	signal: AbortSignal,
	options: {
		interval: number;
		sessionFile?: string;
		doneSentinelFile?: string;
		onTick?: (elapsed: number) => void;
	},
): Promise<PollResult> {
	const start = Date.now();

	while (true) {
		if (signal.aborted) {
			throw new Error("Aborted while waiting for subagent to finish");
		}

		if (options.sessionFile) {
			const exitSignal = consumeSubagentExitSignal(options.sessionFile);
			if (exitSignal) return exitSignal;
		}

		if (options.doneSentinelFile) {
			const sentinel = readDoneSentinel(options.doneSentinelFile);
			if (sentinel) return sentinel;
		}

		try {
			const screen = await readScreenAsync(surface, 5);
			const match = screen.match(/__SUBAGENT_DONE_(\d+)__/);
			if (match) return { reason: "sentinel", exitCode: parseInt(match[1], 10) };
		} catch {
			if (options.sessionFile) {
				const exitSignal = consumeSubagentExitSignal(options.sessionFile);
				if (exitSignal) return exitSignal;
			}
			throw new Error("Failed to read subagent surface while polling for exit");
		}

		const elapsed = Math.floor((Date.now() - start) / 1000);
		options.onTick?.(elapsed);
		await waitForNextPoll(options.interval, signal);
	}
}
