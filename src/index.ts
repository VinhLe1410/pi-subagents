import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import subagentsExtension from "./subagents/index.ts";

export default function combinedExtension(pi: ExtensionAPI) {
	subagentsExtension(pi);
}
