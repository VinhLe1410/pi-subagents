import {
	assert,
	existsSync,
	writeFileSync,
	join,
	afterEach,
	describe,
	it,
	getCompletedSubagentResultForTest,
	joinSubagentsForTest,
	resetSubagentStateForTest,
	routeDetachedSubagentCompletionForTest,
	setRunningSubagentForTest,
	shutdownSubagentsForTest,
	createTestDir,
	sleep,
} from "../support/index.ts";

describe("subagent shutdown policy", () => {
	afterEach(() => {
		resetSubagentStateForTest();
	});

	it("releases completed and pending join members deterministically when join is interrupted", async () => {
		const sent: Array<{ message: any; options: any }> = [];
		let resolveFirst!: (result: any) => void;
		let resolveSecond!: (result: any) => void;
		const firstCompletionPromise = new Promise<any>((resolve) => {
			resolveFirst = resolve;
		});
		const secondCompletionPromise = new Promise<any>((resolve) => {
			resolveSecond = resolve;
		});
		const first = {
			id: "child-join-interrupt-1",
			name: "Completed before interrupt",
			task: "Join first",
			mode: "background" as const,
			executionState: "running" as const,
			deliveryState: "detached" as const,
			parentClosePolicy: "terminate" as const,
			startTime: Date.now(),
			sessionFile: "/tmp/child-join-interrupt-1.jsonl",
			completionPromise: firstCompletionPromise,
		};
		const second = {
			id: "child-join-interrupt-2",
			name: "Pending after interrupt",
			task: "Join second",
			mode: "background" as const,
			executionState: "running" as const,
			deliveryState: "detached" as const,
			parentClosePolicy: "terminate" as const,
			startTime: Date.now(),
			sessionFile: "/tmp/child-join-interrupt-2.jsonl",
			completionPromise: secondCompletionPromise,
		};

		for (const running of [first, second]) {
			setRunningSubagentForTest(running);
			running.completionPromise.then((result: any) => {
				routeDetachedSubagentCompletionForTest(
					{
						sendMessage(message: any, options: any) {
							sent.push({ message, options });
						},
					},
					running,
					result,
				);
			});
		}

		const abort = new AbortController();
		const joinPromise = joinSubagentsForTest(
			{ ids: [first.id, second.id] },
			abort.signal,
			{
				sendMessage(message: any, options: any) {
					sent.push({ message, options });
				},
			},
		);

		resolveFirst({
			name: first.name,
			task: first.task,
			summary: "Completed before interrupt summary",
			sessionFile: first.sessionFile,
			exitCode: 0,
			elapsed: 9,
		});
		await sleep(0);
		assert.equal(sent.length, 0);

		abort.abort();
		const joined = await joinPromise;
		assert.equal((joined.details as any).error, "interrupted");
		assert.equal(first.deliveryState, "joined");
		assert.equal(second.deliveryState, "detached");
		assert.equal(
			getCompletedSubagentResultForTest(first.id)?.deliveredTo,
			"steer",
		);
		assert.equal(sent.length, 1);
		assert.equal((sent[0].message.details as any).id, first.id);

		resolveSecond({
			name: second.name,
			task: second.task,
			summary: "Pending after interrupt summary",
			sessionFile: second.sessionFile,
			exitCode: 0,
			elapsed: 10,
		});
		await sleep(0);

		assert.equal(sent.length, 2);
		assert.equal((sent[1].message.details as any).id, second.id);
		assert.equal(
			getCompletedSubagentResultForTest(second.id)?.deliveredTo,
			"steer",
		);
	});

	it("honors parent close policies during session shutdown", async () => {
		const dir = createTestDir();
		const abandonSessionFile = join(dir, "abandon-child.jsonl");
		writeFileSync(abandonSessionFile, "");

		const terminateAbort = new AbortController();
		let terminateAbortCount = 0;
		terminateAbort.signal.addEventListener(
			"abort",
			() => terminateAbortCount++,
		);

		const terminate = {
			id: "child-close-1",
			name: "Terminate child",
			task: "Stop on shutdown",
			mode: "background" as const,
			executionState: "running" as const,
			deliveryState: "awaited" as const,
			parentClosePolicy: "terminate" as const,
			resultOwner: { kind: "wait" as const, ownerId: "wait:shutdown" },
			startTime: Date.now(),
			sessionFile: "/tmp/child-close-1.jsonl",
			abortController: terminateAbort,
		};
		const abandon = {
			id: "child-close-2",
			name: "Abandon child",
			task: "Keep running",
			mode: "background" as const,
			executionState: "running" as const,
			deliveryState: "joined" as const,
			parentClosePolicy: "continue" as const,
			resultOwner: { kind: "join" as const, ownerId: "join:shutdown" },
			startTime: Date.now(),
			sessionFile: abandonSessionFile,
		};

		for (const running of [terminate, abandon]) {
			setRunningSubagentForTest(running);
		}

		const actions = shutdownSubagentsForTest({
			escalationMs: 10,
		});

		assert.deepEqual(
			actions.map(({ id, action }) => `${id}:${action}`),
			["child-close-1:terminate", "child-close-2:continue"],
		);
		assert.equal(terminateAbortCount, 1);
		assert.equal((terminate as any).resultOwner, undefined);
		assert.equal((abandon as any).resultOwner, undefined);
		assert.equal(terminate.deliveryState, "detached");
		assert.equal(abandon.deliveryState, "detached");
		assert.equal((abandon as any).allowSteerDelivery, false);
		assert.equal(existsSync(abandon.sessionFile), true);

		const sent: Array<{ message: any; options: any }> = [];
		routeDetachedSubagentCompletionForTest(
			{
				sendMessage(message: any, options: any) {
					sent.push({ message, options });
				},
			},
			abandon,
			{
				name: abandon.name,
				task: abandon.task,
				summary: "Finished after parent shutdown",
				sessionFile: abandon.sessionFile,
				exitCode: 0,
				elapsed: 4,
			},
		);

		assert.equal(sent.length, 0);
		assert.equal(getCompletedSubagentResultForTest(abandon.id), undefined);
	});
});
