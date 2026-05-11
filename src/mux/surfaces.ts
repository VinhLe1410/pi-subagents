import { execFileSync, execSync } from "node:child_process";
import {
	getMuxBackend,
	requireMuxBackend,
	shellEscape,
	zellijActionSync,
} from "./core.ts";

export function createSurface(name: string): string {
	const backend = getMuxBackend();
	const surface = createSurfaceSplit(
		name,
		"right",
		backend === "tmux" ? process.env.TMUX_PANE : undefined,
	);

	if (backend === "cmux") {
		try {
			const info = execSync(`cmux identify --surface ${shellEscape(surface)}`, {
				encoding: "utf8",
			});
			const parsed = JSON.parse(info);
			void parsed?.caller?.pane_ref;
		} catch {}
	}

	return surface;
}

function createCmuxSplit(
	name: string,
	direction: "left" | "right" | "up" | "down",
	fromSurface?: string,
): string {
	const surfaceArg = fromSurface ? ` --surface ${shellEscape(fromSurface)}` : "";
	const out = execSync(`cmux new-split ${direction}${surfaceArg} --focus true`, {
		encoding: "utf8",
	}).trim();
	const match = out.match(/surface:\d+/);
	if (!match) throw new Error(`Unexpected cmux new-split output: ${out}`);
	const surface = match[0];
	execSync(
		`cmux rename-tab --surface ${shellEscape(surface)} ${shellEscape(name)}`,
		{ encoding: "utf8" },
	);
	return surface;
}

function createTmuxSplit(
	name: string,
	direction: "left" | "right" | "up" | "down",
	fromSurface?: string,
): string {
	const args = ["split-window"];
	args.push(direction === "left" || direction === "right" ? "-h" : "-v");
	if (direction === "left" || direction === "up") args.push("-b");
	if (fromSurface) args.push("-t", fromSurface);
	args.push("-P", "-F", "#{pane_id}");

	const pane = execFileSync("tmux", args, { encoding: "utf8" }).trim();
	if (!pane.startsWith("%")) {
		throw new Error(`Unexpected tmux split-window output: ${pane}`);
	}

	try {
		execFileSync("tmux", ["select-pane", "-t", pane, "-T", name], {
			encoding: "utf8",
		});
	} catch {}
	return pane;
}

function createWezTermSplit(
	name: string,
	direction: "left" | "right" | "up" | "down",
	fromSurface?: string,
): string {
	const args = ["cli", "split-pane"];
	if (direction === "left") args.push("--left");
	else if (direction === "right") args.push("--right");
	else if (direction === "up") args.push("--top");
	else args.push("--bottom");
	args.push("--cwd", process.cwd());
	if (fromSurface) args.push("--pane-id", fromSurface);
	const paneId = execFileSync("wezterm", args, { encoding: "utf8" }).trim();
	if (!paneId || !/^\d+$/.test(paneId)) {
		throw new Error(`Unexpected wezterm split-pane output: ${paneId || "(empty)"}`);
	}
	try {
		execFileSync(
			"wezterm",
			["cli", "set-tab-title", "--pane-id", paneId, name],
			{ encoding: "utf8" },
		);
	} catch {}
	return paneId;
}

function createZellijSplit(
	name: string,
	direction: "left" | "right" | "up" | "down",
	fromSurface?: string,
): string {
	const directionArg = direction === "left" || direction === "right" ? "right" : "down";
	const args = [
		"new-pane",
		"--direction",
		directionArg,
		"--name",
		name,
		"--cwd",
		process.cwd(),
	];

	let paneOut = "";
	try {
		paneOut = zellijActionSync(args, fromSurface);
	} catch {
		if (!fromSurface) throw new Error("Failed to create zellij pane");
		paneOut = zellijActionSync(args);
	}

	const paneId = paneOut.match(/(?:terminal_)?(\d+)/)?.[1] ?? "";
	if (!paneId || !/^\d+$/.test(paneId)) {
		throw new Error(`Unexpected zellij pane id: ${paneOut.trim() || "(empty)"}`);
	}

	const surface = `pane:${paneId}`;
	if (direction === "left" || direction === "up") {
		try {
			zellijActionSync(["move-pane", direction], surface);
		} catch {}
	}
	try {
		zellijActionSync(["rename-pane", name], surface);
	} catch {}
	return surface;
}

export function createSurfaceSplit(
	name: string,
	direction: "left" | "right" | "up" | "down",
	fromSurface?: string,
): string {
	const backend = requireMuxBackend();
	if (backend === "cmux") return createCmuxSplit(name, direction, fromSurface);
	if (backend === "tmux") return createTmuxSplit(name, direction, fromSurface);
	if (backend === "wezterm") return createWezTermSplit(name, direction, fromSurface);
	return createZellijSplit(name, direction, fromSurface);
}

export function renameCurrentTab(title: string): void {
	const backend = requireMuxBackend();
	if (backend === "cmux") {
		const surfaceId = process.env.CMUX_SURFACE_ID;
		if (!surfaceId) throw new Error("CMUX_SURFACE_ID not set");
		execSync(`cmux rename-tab --surface ${shellEscape(surfaceId)} ${shellEscape(title)}`, {
			encoding: "utf8",
		});
		return;
	}
	if (backend === "tmux") {
		if (process.env.PI_SUBAGENT_RENAME_TMUX_WINDOW !== "1") return;
		const paneId = process.env.TMUX_PANE;
		if (!paneId) throw new Error("TMUX_PANE not set");
		const windowId = execFileSync(
			"tmux",
			["display-message", "-p", "-t", paneId, "#{window_id}"],
			{ encoding: "utf8" },
		).trim();
		execFileSync("tmux", ["rename-window", "-t", windowId, title], {
			encoding: "utf8",
		});
		return;
	}
	if (backend === "wezterm") {
		const paneId = process.env.WEZTERM_PANE;
		const args = ["cli", "set-tab-title"];
		if (paneId) args.push("--pane-id", paneId);
		args.push(title);
		execFileSync("wezterm", args, { encoding: "utf8" });
		return;
	}
	const paneId = process.env.ZELLIJ_PANE_ID;
	if (paneId) zellijActionSync(["rename-pane", title], `pane:${paneId}`);
	else zellijActionSync(["rename-tab", title]);
}

export function renameWorkspace(title: string): void {
	const backend = requireMuxBackend();
	if (backend === "cmux") {
		execSync(`cmux workspace-action --action rename --title ${shellEscape(title)}`, {
			encoding: "utf8",
		});
		return;
	}
	if (backend === "tmux") {
		if (process.env.PI_SUBAGENT_RENAME_TMUX_SESSION !== "1") return;
		const paneId = process.env.TMUX_PANE;
		if (!paneId) throw new Error("TMUX_PANE not set");
		const sessionId = execFileSync(
			"tmux",
			["display-message", "-p", "-t", paneId, "#{session_id}"],
			{ encoding: "utf8" },
		).trim();
		execFileSync("tmux", ["rename-session", "-t", sessionId, title], {
			encoding: "utf8",
		});
		return;
	}
	if (backend === "wezterm") {
		const paneId = process.env.WEZTERM_PANE;
		const args = ["cli", "set-window-title"];
		if (paneId) args.push("--pane-id", paneId);
		args.push(title);
		try {
			execFileSync("wezterm", args, { encoding: "utf8" });
		} catch {}
	}
}
