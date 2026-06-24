/**
 * Internal extension loaded into sub-agent children.
 *
 * It does not expose child protocol tools. It only enforces denied tools,
 * records exit metadata, renders a small child widget, and shuts down the child
 * after the final assistant message when auto-exit is enabled.
 */

import { existsSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	findLatestAssistantError,
	shouldAutoExitOnAgentEnd,
	shouldMarkUserTookOver,
} from "../auto-exit.ts";

function getDeniedToolNames(
	autoExit: boolean,
	deniedEnv = process.env.PI_DENY_TOOLS ?? "",
): string[] {
	const denied = deniedEnv
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	void autoExit;
	return denied;
}

function filterToolNames(
	toolNames: string[],
	deniedTools: string[],
): string[] {
	const denied = new Set(deniedTools);
	const seen = new Set<string>();
	return toolNames.filter((name) => {
		if (!name || denied.has(name) || seen.has(name)) return false;
		seen.add(name);
		return true;
	});
}

type WidgetThemeLike = {
	bg(tone: string, text: string): string;
	bold(text: string): string;
	fg(tone: string, text: string): string;
};

export default function (pi: ExtensionAPI) {
	const autoExit = process.env.PI_SUBAGENT_AUTO_EXIT === "1";
	let outputTokens = 0;

	function requestShutdown(ctx: { shutdown: () => void }) {
		setTimeout(() => {
			try {
				ctx.shutdown();
			} catch {
				// Context may already be stale after session shutdown/reload.
			}
		}, 0);
	}

	function writeExitSignal(payload: object) {
		const sessionFile = process.env.PI_SUBAGENT_SESSION;
		if (!sessionFile) return;
		const exitFile = `${sessionFile}.exit`;
		if (existsSync(exitFile)) return;
		writeFileSync(exitFile, JSON.stringify(payload), "utf8");
	}

	const subagentName = process.env.PI_SUBAGENT_NAME ?? "";
	const subagentAgent = process.env.PI_SUBAGENT_AGENT ?? "";

	function enforceDeniedTools() {
		const deniedNames = getDeniedToolNames(autoExit);
		const allowedTools = filterToolNames(pi.getActiveTools(), deniedNames);
		try {
			pi.setActiveTools(allowedTools);
		} catch {
			// Tools may not be ready yet.
		}
	}

	pi.on("session_start", (_event, ctx) => {
		enforceDeniedTools();
		setTimeout(() => enforceDeniedTools(), 0);
		setTimeout(() => enforceDeniedTools(), 250);

		ctx.ui.setWidget(
			"subagent-tools",
			(_tui: unknown, theme: WidgetThemeLike) => ({
				render: () => {
					const avail = Math.max(1, ((_tui as { terminal?: { columns?: number } })?.terminal?.columns ?? 80) - 1);
					const visibleLabel = subagentAgent
						? `${subagentName} (${subagentAgent})`
						: subagentName;
					const visiblePrefix = "▸ Agent ";
					let displayLabel = visibleLabel;
					if (visiblePrefix.length + visibleLabel.length > avail) {
						const maxLabel = Math.max(0, avail - visiblePrefix.length - 1);
						displayLabel = visibleLabel.slice(0, maxLabel) + "…";
					}
					const nameLen = Math.min(subagentName.length, displayLabel.length);
					const styledName = theme.bold(displayLabel.slice(0, nameLen));
					const styledSuffix = nameLen < displayLabel.length
						? theme.fg("muted", displayLabel.slice(nameLen))
						: "";
					return [`${theme.fg("accent", "▸")} ${theme.fg("accent", "Agent")} ${styledName}${styledSuffix}`];
				},
				invalidate: () => {},
			}),
			{ placement: "aboveEditor" },
		);
	});

	pi.on("before_agent_start", () => {
		enforceDeniedTools();
	});

	pi.on("message_end", (event) => {
		const message = event.message as {
			role?: string;
			usage?: { output?: number };
		};
		if (message.role !== "assistant" || !message.usage) return;
		outputTokens += message.usage.output ?? 0;
	});

	pi.on("session_shutdown", () => {
		writeExitSignal({ type: "done", outputTokens });
	});

	if (!autoExit) return;

	let userTookOver = false;
	let agentStarted = false;

	pi.on("agent_start", () => {
		agentStarted = true;
		userTookOver = false;
	});

	pi.on("input", (event) => {
		if (!shouldMarkUserTookOver(agentStarted, event.streamingBehavior)) return;
		userTookOver = true;
	});

	pi.on("agent_end", (event, ctx) => {
		const messages = event.messages as Parameters<
			typeof shouldAutoExitOnAgentEnd
		>[0];
		const shouldExit = shouldAutoExitOnAgentEnd(messages);
		if (!shouldExit || userTookOver) return;

		const errorInfo = findLatestAssistantError(messages);
		if (errorInfo) {
			const sessionFile = process.env.PI_SUBAGENT_SESSION;
			if (sessionFile) {
				try {
					writeFileSync(
						`${sessionFile}.exit`,
						JSON.stringify({
							type: "error",
							errorMessage: errorInfo.errorMessage,
							stopReason: errorInfo.stopReason,
						}),
					);
				} catch {}
			}
		}

		writeExitSignal({ type: "done", outputTokens });
		requestShutdown(ctx);
	});
}
