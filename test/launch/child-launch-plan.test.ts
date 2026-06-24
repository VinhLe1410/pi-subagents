import {
	assert,
	createTestDir,
	describe,
	it,
	join,
} from "../support/index.ts";
import { buildChildLaunchPlan } from "../../src/launch/child-launch-plan.ts";

describe("child launch plan", () => {
	it("uses agent model/tools and hardcoded simple child capabilities", async () => {
		const cwd = createTestDir();
		const parentSessionDir = join(cwd, "parent-sessions");

		const plan = await buildChildLaunchPlan({
			params: {
				name: "code-review",
				task: "review the diff",
				title: "Code review",
				agent: "reviewer",
			},
			agentDefs: {
				model: "provider/default",
				thinking: "low",
				tools: "read,bash",
			},
			parentCwd: cwd,
			parentSessionDir,
			parentModelRef: "provider/parent",
			parentThinking: "medium",
		});

		assert.equal(plan.effectiveModel, "provider/default");
		assert.equal(plan.effectiveThinking, "low");
		assert.equal(plan.effectiveModelRef, "provider/default:low");
		assert.equal(plan.runtimePaths.effectiveCwd, null);
		assert.equal(plan.runtimePaths.targetCwdForSession, cwd);
		assert.ok(plan.subagentSessionFile.startsWith(`${parentSessionDir}/`));

		assert.equal(plan.capability.tools, "read,bash");
		assert.equal(plan.capability.skills, "none");
		assert.equal(plan.capability.injectSkills, undefined);
		assert.deepEqual(plan.capability.extensions, []);
		assert.deepEqual([...plan.capability.denySet].sort(), ["subagent"]);
		assert.deepEqual(plan.capability.skillLaunchPlan.launchArgs, ["--no-skills"]);
	});

	it("inherits parent model and thinking when the agent has no defaults", async () => {
		const cwd = createTestDir();
		const parentSessionDir = join(cwd, "parent-sessions");

		const plan = await buildChildLaunchPlan({
			params: {
				name: "code-review",
				task: "review the diff",
				title: "Code review",
				agent: "reviewer",
			},
			agentDefs: {},
			parentCwd: cwd,
			parentSessionDir,
			parentModelRef: "zai-messages/glm-5-turbo",
			parentThinking: "off",
		});

		assert.equal(plan.effectiveModelRef, "zai-messages/glm-5-turbo:off");
	});

	it("passes bare agent default models through untouched", async () => {
		const cwd = createTestDir();
		const parentSessionDir = join(cwd, "parent-sessions");

		const plan = await buildChildLaunchPlan({
			params: {
				name: "code-review",
				task: "review the diff",
				title: "Code review",
				agent: "reviewer",
			},
			agentDefs: {
				model: "some-bare-model",
			},
			parentCwd: cwd,
			parentSessionDir,
			modelRegistry: {
				getAvailable: () => [
					{ provider: "zai-messages", id: "glm-5.1" },
				],
			},
		});

		assert.equal(plan.effectiveModel, "some-bare-model");
	});
});
