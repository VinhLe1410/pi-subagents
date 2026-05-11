import { existsSync } from "node:fs";
import { basename } from "node:path";
import { shellEscape } from "../mux.ts";

export interface PiInvocation {
	command: string;
	args: string[];
}

/**
 * Split a command override into argv parts. This intentionally supports only
 * shell-style quoting/escaping, not expansion or operators, because the result
 * is also used with spawn() for background subagents.
 */
export function parseCommandWords(command: string): string[] {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaping = false;

	for (const char of command.trim()) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaping = true;
			continue;
		}
		if ((char === "'" || char === '"') && quote === null) {
			quote = char;
			continue;
		}
		if (char === quote) {
			quote = null;
			continue;
		}
		if (/\s/.test(char) && quote === null) {
			if (current) {
				words.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}

	if (escaping) current += "\\";
	if (quote !== null)
		throw new Error("PI_SUBAGENT_PI_COMMAND has an unterminated quote");
	if (current) words.push(current);
	return words;
}

/**
 * Resolve the correct pi binary path for spawn(). Handles node, bun,
 * bundled executables, and opt-in wrapper commands such as `tia pi`.
 */
export function getPiInvocation(args: string[]): PiInvocation {
	const override = process.env.PI_SUBAGENT_PI_COMMAND?.trim();
	if (override) {
		const parts = parseCommandWords(override);
		if (parts.length === 0) {
			throw new Error("PI_SUBAGENT_PI_COMMAND did not contain a command");
		}
		return { command: parts[0], args: [...parts.slice(1), ...args] };
	}

	if (isTiaParentProcess()) {
		return { command: "tia", args: ["pi", ...args] };
	}

	const currentScript = process.argv[1];
	if (currentScript && existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}
	return { command: "pi", args };
}

export function getPiShellParts(args: string[]): string[] {
	const invocation = getPiInvocation(args);
	return [
		shellEscape(invocation.command),
		...invocation.args.map((arg) => shellEscape(arg)),
	];
}

function isTiaParentProcess(): boolean {
	if (process.env.TIA_ACTIVE === "1") return true;
	const command = process.env.TIA_COMMAND?.trim();
	if (command === "tia pi" || command === "tia") return true;
	const packageDir = process.env.PI_PACKAGE_DIR ?? "";
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? "";
	return packageDir.includes("/tia/") || agentDir.includes("/tia/pi-agent");
}

function shouldUnsetInheritedTiaEnv(invocation: PiInvocation): boolean {
	const commandName = basename(invocation.command).toLowerCase();
	const launchedViaEnv =
		commandName === "env" &&
		invocation.args.some((arg) => basename(arg).toLowerCase() === "pi");
	const launchedViaPi =
		commandName === "pi" || commandName === "pi.exe" || launchedViaEnv;
	if (!launchedViaPi) return false;
	const packageDir = process.env.PI_PACKAGE_DIR ?? "";
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? "";
	return packageDir.includes("/tia/") || agentDir.includes("/tia/pi-agent");
}

export function getSubagentChildProcessEnv(
	invocation: PiInvocation,
	envVars: Record<string, string>,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env, ...envVars };
	if (shouldUnsetInheritedTiaEnv(invocation)) {
		delete env.PI_PACKAGE_DIR;
		if (
			!envVars.PI_CODING_AGENT_DIR ||
			envVars.PI_CODING_AGENT_DIR === process.env.PI_CODING_AGENT_DIR
		) {
			delete env.PI_CODING_AGENT_DIR;
		}
	}
	return env;
}
