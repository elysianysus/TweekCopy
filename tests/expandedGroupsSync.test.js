import { test } from "node:test";
import assert from "node:assert/strict";

import { createExpandedGroupsSync } from "../src/components/forms/expandedGroupsSync.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("schedule fires send with the value after the delay", async () => {
    const calls = [];
    const sync = createExpandedGroupsSync({ delay: 10, send: (v) => calls.push(v) });
    sync.schedule(["a"]);
    assert.equal(sync.isPending(), true);
    await sleep(40);
    assert.deepEqual(calls, [["a"]]);
    assert.equal(sync.isPending(), false);
});

test("multiple schedules within the delay coalesce and fire once with the latest value", async () => {
    const calls = [];
    const sync = createExpandedGroupsSync({ delay: 15, send: (v) => calls.push(v) });
    sync.schedule(["a"]);
    sync.schedule(["a", "b"]);
    sync.schedule(["a", "b", "c"]);
    await sleep(50);
    assert.deepEqual(calls, [["a", "b", "c"]]);
});

test("flush sends the LATEST scheduled value, not the first (regression: unmount-with-stale-state)", () => {
    const calls = [];
    // Use a long delay so the timer would not fire on its own during the test.
    const sync = createExpandedGroupsSync({ delay: 10_000, send: (v) => calls.push(v) });
    sync.schedule(["initial-default"]);
    sync.schedule(["after-user-toggle"]);
    sync.flush();
    assert.deepEqual(calls, [["after-user-toggle"]]);
    assert.equal(sync.isPending(), false);
});

test("flush with no pending value is a no-op", () => {
    const calls = [];
    const sync = createExpandedGroupsSync({ delay: 10, send: (v) => calls.push(v) });
    sync.flush();
    assert.deepEqual(calls, []);
});

test("cancel drops the pending value without firing send", async () => {
    const calls = [];
    const sync = createExpandedGroupsSync({ delay: 10, send: (v) => calls.push(v) });
    sync.schedule(["a"]);
    sync.cancel();
    assert.equal(sync.isPending(), false);
    await sleep(40);
    assert.deepEqual(calls, []);
});

test("schedule works again after a previous fire", async () => {
    const calls = [];
    const sync = createExpandedGroupsSync({ delay: 10, send: (v) => calls.push(v) });
    sync.schedule(["first"]);
    await sleep(40);
    sync.schedule(["second"]);
    await sleep(40);
    assert.deepEqual(calls, [["first"], ["second"]]);
});

test("schedule works again after a flush", async () => {
    const calls = [];
    const sync = createExpandedGroupsSync({ delay: 50, send: (v) => calls.push(v) });
    sync.schedule(["a"]);
    sync.flush();
    sync.schedule(["b"]);
    await sleep(120);
    assert.deepEqual(calls, [["a"], ["b"]]);
});

test("missing send callback does not throw", () => {
    const sync = createExpandedGroupsSync({ delay: 5 });
    sync.schedule(["a"]);
    assert.doesNotThrow(() => sync.flush());
});
