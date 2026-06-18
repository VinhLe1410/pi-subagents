import {
	createHerdrWorkspaceSurface,
	getHerdrCurrentPane,
	getHerdrWorkspace,
	renameHerdrTab,
	renameHerdrWorkspace,
	splitHerdrPane,
} from "./herdr.ts";

type SurfaceSplitDirection = "left" | "right" | "up" | "down";

function assertSupportedHerdrSplitDirection(
	direction: SurfaceSplitDirection,
): asserts direction is "right" | "down" {
	if (direction === "right" || direction === "down") return;
	throw new Error(
		`Herdr split direction "${direction}" is unsupported; Herdr pane split supports only right and down`,
	);
}

function numberedHerdrWorkspaceTitle(title: string, workspaceNumber: number | undefined): string {
	if (workspaceNumber === undefined) return title;
	const cleanTitle = title.replace(/^\d+:\s*/, "").trim();
	return `${workspaceNumber}: ${cleanTitle}`;
}

function isSubagentProcess(): boolean {
	return !!(process.env.PI_SUBAGENT_NAME || process.env.PI_SUBAGENT_SESSION);
}

export function createHerdrSurface(name: string): string {
	const surface = createHerdrWorkspaceSurface({
		label: name,
		cwd: process.cwd(),
		focus: false,
	});
	renameHerdrWorkspace(
		surface.workspace.workspaceId,
		numberedHerdrWorkspaceTitle(name, surface.workspace.number),
	);
	return surface.pane.paneId;
}

export function createHerdrSplit(
	_name: string,
	direction: SurfaceSplitDirection,
	fromSurface?: string,
): string {
	assertSupportedHerdrSplitDirection(direction);
	return splitHerdrPane({
		paneId: fromSurface,
		direction,
		cwd: process.cwd(),
		focus: false,
	}).paneId;
}

function currentHerdrTabId(): string {
	const envTabId = process.env.HERDR_TAB_ID?.trim();
	if (envTabId) return envTabId;
	const tabId = getHerdrCurrentPane().tabId;
	if (!tabId) throw new Error("Herdr current pane did not report a tab id");
	return tabId;
}

function currentHerdrWorkspaceId(): string {
	const envWorkspaceId = process.env.HERDR_WORKSPACE_ID?.trim();
	if (envWorkspaceId) return envWorkspaceId;
	const workspaceId = getHerdrCurrentPane().workspaceId;
	if (!workspaceId) {
		throw new Error("Herdr current pane did not report a workspace id");
	}
	return workspaceId;
}

export function renameHerdrCurrentTab(title: string): void {
	renameHerdrTab(currentHerdrTabId(), title);
}

export function renameHerdrCurrentWorkspace(title: string): void {
	const workspaceId = currentHerdrWorkspaceId();
	if (!isSubagentProcess()) {
		renameHerdrWorkspace(workspaceId, title);
		return;
	}
	const workspace = getHerdrWorkspace(workspaceId);
	renameHerdrWorkspace(
		workspaceId,
		numberedHerdrWorkspaceTitle(title, workspace.number),
	);
}
