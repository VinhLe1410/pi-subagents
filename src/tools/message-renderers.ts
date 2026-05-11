import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { keyHint } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import type {
	SubagentPingMessageDetails,
	SubagentResultMessageDetails,
} from "../types.ts";

export function registerSubagentMessageRenderers(
	pi: ExtensionAPI,
	formatElapsed: (elapsed: number) => string,
): void {
	pi.registerMessageRenderer("subagent_result", (message, options, theme) => {
		const details = message.details as SubagentResultMessageDetails | undefined;
		if (!details) return undefined;

		return {
			invalidate() {},
			render(width: number): string[] {
				const name = details.name ?? "subagent";
				const exitCode = details.exitCode ?? 0;
				const elapsed =
					details.elapsed != null ? formatElapsed(details.elapsed) : "?";
				const bgFn =
					exitCode === 0
						? (text: string) => theme.bg("toolSuccessBg", text)
						: (text: string) => theme.bg("toolErrorBg", text);
				const icon =
					exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
				const status =
					exitCode === 0 ? "completed" : `failed (exit ${exitCode})`;
				const agentTag = details.agent
					? theme.fg("dim", ` (${details.agent})`)
					: "";

				const header = `${icon} ${theme.fg("toolTitle", theme.bold(name))}${agentTag} ${theme.fg("dim", "—")} ${status} ${theme.fg("dim", `(${elapsed})`)}`;
				const rawContent =
					typeof message.content === "string" ? message.content : "";

				const summary = rawContent
					.replace(/\n\nSession: .+\nResume: .+$/, "")
					.replace(`Sub-agent "${name}" completed (${elapsed}).\n\n`, "")
					.replace(
						`Sub-agent "${name}" failed (exit code ${exitCode}).\n\n`,
						"",
					);

				const contentLines = [header];

				if (options.expanded) {
					if (summary) {
						for (const line of summary.split("\n")) {
							contentLines.push(line.slice(0, width - 6));
						}
					}
					if (details.sessionFile) {
						contentLines.push("");
						contentLines.push(
							theme.fg("dim", `Session: ${details.sessionFile}`),
						);
						contentLines.push(
							theme.fg("dim", `Resume:  pi --session ${details.sessionFile}`),
						);
					}
				} else {
					if (summary) {
						const previewLines = summary.split("\n").slice(0, 5);
						for (const line of previewLines) {
							contentLines.push(theme.fg("dim", line.slice(0, width - 6)));
						}
						const totalLines = summary.split("\n").length;
						if (totalLines > 5) {
							contentLines.push(
								theme.fg("muted", `… ${totalLines - 5} more lines`),
							);
						}
					}
					contentLines.push(
						theme.fg("muted", keyHint("app.tools.expand", "to expand")),
					);
				}

				const box = new Box(1, 1, bgFn);
				box.addChild(new Text(contentLines.join("\n"), 0, 0));
				return ["", ...box.render(width)];
			},
		};
	});

	pi.registerMessageRenderer("subagent_ping", (message, options, theme) => {
		const details = message.details as SubagentPingMessageDetails | undefined;
		if (!details) return undefined;

		return {
			invalidate() {},
			render(width: number): string[] {
				const name = details.name ?? "subagent";
				const elapsed =
					details.elapsed != null ? formatElapsed(details.elapsed) : "?";
				const agentTag = details.agent
					? theme.fg("dim", ` (${details.agent})`)
					: "";
				const header = `${theme.fg("accent", "?")} ${theme.fg("toolTitle", theme.bold(name))}${agentTag} ${theme.fg("dim", "—")} needs help ${theme.fg("dim", `(${elapsed})`)}`;
				const rawMessage =
					details.message ??
					(typeof message.content === "string" ? message.content : "");
				const body = rawMessage.replace(/\n\nSession: .+\nResume: .+$/, "");
				const contentLines = [header];

				if (options.expanded) {
					for (const line of body.split("\n")) {
						if (line) contentLines.push(line.slice(0, width - 6));
					}
					if (details.sessionFile) {
						contentLines.push("");
						contentLines.push(
							theme.fg("dim", `Session: ${details.sessionFile}`),
						);
						contentLines.push(
							theme.fg("dim", `Resume:  pi --session ${details.sessionFile}`),
						);
					}
				} else {
					const previewLines = body.split("\n").filter(Boolean).slice(0, 4);
					for (const line of previewLines) {
						contentLines.push(theme.fg("dim", line.slice(0, width - 6)));
					}
					contentLines.push(
						theme.fg("muted", keyHint("app.tools.expand", "to expand")),
					);
				}

				const box = new Box(1, 1, (text: string) =>
					theme.bg("toolPendingBg", text),
				);
				box.addChild(new Text(contentLines.join("\n"), 0, 0));
				return ["", ...box.render(width)];
			},
		};
	});
}
