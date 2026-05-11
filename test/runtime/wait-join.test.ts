import {
	assert,
	afterEach,
	describe,
	it,
	getCompletedSubagentResultForTest,
	joinSubagentsForTest,
	resetSubagentStateForTest,
	routeDetachedSubagentCompletionForTest,
	setRunningSubagentForTest,
	waitForSubagentForTest,
	sleep,
} from "../support/index.ts";

describe("subagent wait and join behavior", () => {
	afterEach(() => {
		resetSubagentStateForTest();
	});

	it("returns cached result when wait follows steer delivery", async () => {
		const sent: Array<{ message: any; options: any }> = [];
		const running = {
			id: "child-wait-2",
			name: "Already delivered child",
			task: "Too late",
			mode: "background" as const,
			executionState: "running" as const,
			deliveryState: "detached" as const,
			parentClosePolicy: "terminate" as const,
			startTime: Date.now(),
			sessionFile: "/tmp/child-wait-2.jsonl",
		};

		routeDetachedSubagentCompletionForTest(
			{
				sendMessage(message: any, options: any) {
					sent.push({ message, options });
				},
			},
			running,
			{
				name: running.name,
				task: running.task,
				summary: "Detached completion summary",
				sessionFile: running.sessionFile,
				exitCode: 0,
				elapsed: 1,
			},
		);

		const waited = await waitForSubagentForTest({ id: running.id });
		assert.equal(sent.length, 1);
		assert.equal((waited.details as any).id, running.id);
		assert.equal((waited.details as any).name, running.name);
		assert.equal((waited.details as any).status, "completed");
		assert.equal((waited.details as any).deliveryState, "awaited");
		assert.equal((waited.details as any).exitCode, 0);
	});

	it("returns pending on wait timeout and restores detached delivery", async () => {
		const sent: Array<{ message: any; options: any }> = [];
		let resolveCompletion!: (result: any) => void;
		const completionPromise = new Promise<any>((resolve) => {
			resolveCompletion = resolve;
		});
		const running = {
			id: "child-wait-3",
			name: "Slow child",
			task: "Still running",
			mode: "background" as const,
			executionState: "running" as const,
			deliveryState: "detached" as const,
			parentClosePolicy: "terminate" as const,
			startTime: Date.now(),
			sessionFile: "/tmp/child-wait-3.jsonl",
			completionPromise,
		};

		setRunningSubagentForTest(running);
		completionPromise.then((result) => {
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

		const waited = await waitForSubagentForTest({
			id: running.id,
			timeout: 0.01,
			onTimeout: "detach",
		});

		assert.equal((waited.details as any).status, "pending");
		assert.equal((waited.details as any).deliveryState, "detached");
		assert.equal(running.deliveryState, "detached");

		resolveCompletion({
			name: running.name,
			task: running.task,
			summary: "Late completion summary",
			sessionFile: running.sessionFile,
			exitCode: 0,
			elapsed: 3,
		});
		await sleep(0);

		assert.equal(sent.length, 1);
		assert.equal((sent[0].message.details as any).id, running.id);
		assert.equal((sent[0].message.details as any).deliveryState, "detached");
		assert.equal(
			getCompletedSubagentResultForTest(running.id)?.deliveredTo,
			"steer",
		);
	});

	it("joins cached results that were already delivered by wait", async () => {
		const running = {
			id: "child-join-after-wait",
			name: "Join after wait child",
			task: "Wait then join",
			mode: "background" as const,
			executionState: "running" as const,
			deliveryState: "detached" as const,
			parentClosePolicy: "terminate" as const,
			startTime: Date.now(),
			sessionFile: "/tmp/child-join-after-wait.jsonl",
			completionPromise: Promise.resolve({
				name: "Join after wait child",
				task: "Wait then join",
				summary: "Done",
				sessionFile: "/tmp/child-join-after-wait.jsonl",
				exitCode: 0,
				elapsed: 1,
			}),
		};

		setRunningSubagentForTest(running);
		const waited = await waitForSubagentForTest({ id: running.name });
		assert.equal((waited.details as any).status, "completed");

		const joined = await joinSubagentsForTest({ ids: [running.name] });
		assert.equal((joined.details as any).ids[0], running.id);
		assert.equal((joined.details as any).results[running.id].exitCode, 0);
		assert.equal(
			(joined.details as any).results[running.id].sessionFile,
			running.sessionFile,
		);
	});

	it("joins multiple running subagents and suppresses steer delivery", async () => {
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
			id: "child-join-1",
			name: "First join child",
			task: "First task",
			mode: "background" as const,
			executionState: "running" as const,
			deliveryState: "detached" as const,
			parentClosePolicy: "terminate" as const,
			startTime: Date.now(),
			sessionFile: "/tmp/child-join-1.jsonl",
			completionPromise: firstCompletionPromise,
		};
		const second = {
			id: "child-join-2",
			name: "Second join child",
			task: "Second task",
			mode: "background" as const,
			executionState: "running" as const,
			deliveryState: "detached" as const,
			parentClosePolicy: "terminate" as const,
			startTime: Date.now(),
			sessionFile: "/tmp/child-join-2.jsonl",
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

		const joinPromise = joinSubagentsForTest({ ids: [first.name, second.id] });
		assert.equal(first.deliveryState, "joined");
		assert.equal(second.deliveryState, "joined");

		resolveFirst({
			name: first.name,
			task: first.task,
			summary: "First joined summary",
			sessionFile: first.sessionFile,
			exitCode: 0,
			elapsed: 2,
		});
		await sleep(0);
		resolveSecond({
			name: second.name,
			task: second.task,
			summary: "Second joined summary",
			sessionFile: second.sessionFile,
			exitCode: 0,
			elapsed: 3,
		});

		const joined = await joinPromise;
		assert.equal((joined.details as any).status, "completed");
		assert.equal((joined.details as any).deliveryState, "joined");
		assert.deepEqual((joined.details as any).ids, [first.id, second.id]);
		assert.deepEqual(Object.keys((joined.details as any).results).sort(), [
			first.id,
			second.id,
		]);
		assert.equal(sent.length, 0);
		assert.equal(
			getCompletedSubagentResultForTest(first.id)?.deliveredTo,
			"join",
		);
		assert.equal(
			getCompletedSubagentResultForTest(second.id)?.deliveredTo,
			"join",
		);
	});

	it("returns partial join results on timeout and releases pending children back to steer", async () => {
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
			id: "child-join-3",
			name: "Partial join child",
			task: "First partial task",
			mode: "background" as const,
			executionState: "running" as const,
			deliveryState: "detached" as const,
			parentClosePolicy: "terminate" as const,
			startTime: Date.now(),
			sessionFile: "/tmp/child-join-3.jsonl",
			completionPromise: firstCompletionPromise,
		};
		const second = {
			id: "child-join-4",
			name: "Late steer child",
			task: "Second partial task",
			mode: "background" as const,
			executionState: "running" as const,
			deliveryState: "detached" as const,
			parentClosePolicy: "terminate" as const,
			startTime: Date.now(),
			sessionFile: "/tmp/child-join-4.jsonl",
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

		const joinPromise = joinSubagentsForTest({
			ids: [first.id, second.id],
			timeout: 0.01,
			onTimeout: "return_partial",
		});

		resolveFirst({
			name: first.name,
			task: first.task,
			summary: "Partial joined summary",
			sessionFile: first.sessionFile,
			exitCode: 0,
			elapsed: 4,
		});

		const joined = await joinPromise;
		assert.equal((joined.details as any).status, "partial");
		assert.deepEqual((joined.details as any).pendingIds, [second.id]);
		assert.equal((joined.details as any).results[first.id].exitCode, 0);
		assert.equal(first.deliveryState, "joined");
		assert.equal(second.deliveryState, "detached");
		assert.equal(
			getCompletedSubagentResultForTest(first.id)?.deliveredTo,
			"join",
		);

		resolveSecond({
			name: second.name,
			task: second.task,
			summary: "Late steer summary",
			sessionFile: second.sessionFile,
			exitCode: 0,
			elapsed: 5,
		});
		await sleep(0);

		assert.equal(sent.length, 1);
		assert.equal((sent[0].message.details as any).id, second.id);
		assert.equal((sent[0].message.details as any).deliveryState, "detached");
		assert.equal(
			getCompletedSubagentResultForTest(second.id)?.deliveredTo,
			"steer",
		);
	});

	it("returns timeout errors for wait and restores detached delivery", async () => {
		const sent: Array<{ message: any; options: any }> = [];
		let resolveCompletion!: (result: any) => void;
		const completionPromise = new Promise<any>((resolve) => {
			resolveCompletion = resolve;
		});
		const running = {
			id: "child-wait-timeout-error",
			name: "Timeout child",
			task: "Miss the deadline",
			mode: "background" as const,
			executionState: "running" as const,
			deliveryState: "detached" as const,
			parentClosePolicy: "terminate" as const,
			startTime: Date.now(),
			sessionFile: "/tmp/child-wait-timeout-error.jsonl",
			completionPromise,
		};

		setRunningSubagentForTest(running);
		completionPromise.then((result) => {
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

		const waited = await waitForSubagentForTest({
			id: running.id,
			timeout: 0.01,
		});
		assert.equal((waited.details as any).error, "timeout");
		assert.equal(running.deliveryState, "detached");
		assert.equal((running as any).resultOwner, undefined);

		resolveCompletion({
			name: running.name,
			task: running.task,
			summary: "Late timeout summary",
			sessionFile: running.sessionFile,
			exitCode: 0,
			elapsed: 7,
		});
		await sleep(0);

		assert.equal(sent.length, 1);
		assert.equal((sent[0].message.details as any).id, running.id);
		assert.equal(
			getCompletedSubagentResultForTest(running.id)?.deliveredTo,
			"steer",
		);
	});

	it("returns invalid_ids for empty or duplicate join sets", async () => {
		const empty = await joinSubagentsForTest({ ids: [] });
		assert.equal((empty.details as any).error, "invalid_ids");

		const duplicate = await joinSubagentsForTest({
			ids: ["dup-child", "dup-child"],
		});
		assert.equal((duplicate.details as any).error, "invalid_ids");
	});

	it("releases awaited children back to steer when wait is interrupted", async () => {
		const sent: Array<{ message: any; options: any }> = [];
		let resolveCompletion!: (result: any) => void;
		const completionPromise = new Promise<any>((resolve) => {
			resolveCompletion = resolve;
		});
		const running = {
			id: "child-wait-interrupt-1",
			name: "Interrupted wait child",
			task: "Resume detached delivery",
			mode: "background" as const,
			executionState: "running" as const,
			deliveryState: "detached" as const,
			parentClosePolicy: "terminate" as const,
			startTime: Date.now(),
			sessionFile: "/tmp/child-wait-interrupt-1.jsonl",
			completionPromise,
		};

		setRunningSubagentForTest(running);
		completionPromise.then((result) => {
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

		const abort = new AbortController();
		const waitPromise = waitForSubagentForTest(
			{ id: running.id },
			abort.signal,
		);
		assert.equal(running.deliveryState, "awaited");

		abort.abort();
		const waited = await waitPromise;
		assert.equal((waited.details as any).error, "interrupted");
		assert.equal(running.deliveryState, "detached");
		assert.equal((running as any).resultOwner, undefined);

		resolveCompletion({
			name: running.name,
			task: running.task,
			summary: "Interrupted wait summary",
			sessionFile: running.sessionFile,
			exitCode: 0,
			elapsed: 8,
		});
		await sleep(0);

		assert.equal(sent.length, 1);
		assert.equal(sent[0].options.deliverAs, "steer");
		assert.equal(
			getCompletedSubagentResultForTest(running.id)?.deliveredTo,
			"steer",
		);
	});

});
