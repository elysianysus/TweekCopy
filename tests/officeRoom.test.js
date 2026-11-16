import { test, after } from "node:test";
import assert from "node:assert/strict";

after(() => { setTimeout(() => process.exit(0), 100).unref(); });

import {
    ROOM_COLS, ROOM_ROWS,
    computeDeskLayout, isBlocked, findAdjacentWorker, summarizeJobs,
} from "../src/lib/officeRoom.js";

test("computeDeskLayout places every worker inside the room walls", () => {
    for (const n of [1, 3, 6, 8, 11, 16]) {
        const layout = computeDeskLayout(n);
        assert.equal(layout.length, n);
        for (const p of layout) {
            assert.ok(p.deskX > 0 && p.deskX < ROOM_COLS - 1, `deskX in bounds: ${p.deskX}`);
            assert.ok(p.deskY > 0 && p.deskY < ROOM_ROWS - 1, `deskY in bounds: ${p.deskY}`);
            assert.ok(p.workerY === p.deskY - 1, "worker sits behind their desk");
            assert.ok(p.interactY === p.deskY + 1, "interact tile is in front of the desk");
        }
        // No two desks share a tile.
        const seen = new Set();
        for (const p of layout) {
            const k = `${p.deskX},${p.deskY}`;
            assert.ok(!seen.has(k), `desk collision at ${k}`);
            seen.add(k);
        }
    }
});

test("isBlocked treats walls, desks, and workers as blocked", () => {
    const workers = computeDeskLayout(3).map((p, i) => ({ ...p, key: `w${i}` }));
    // Walls
    assert.equal(isBlocked(workers, 0, 5), true);
    assert.equal(isBlocked(workers, ROOM_COLS - 1, 5), true);
    assert.equal(isBlocked(workers, 5, 0), true);
    assert.equal(isBlocked(workers, 5, ROOM_ROWS - 1), true);
    // Inside, away from desks: walkable
    assert.equal(isBlocked(workers, 1, ROOM_ROWS - 2), false);
    // Desk and worker tiles are blocked
    const w = workers[0];
    assert.equal(isBlocked(workers, w.deskX, w.deskY), true);
    assert.equal(isBlocked(workers, w.workerX, w.workerY), true);
});

test("findAdjacentWorker returns the worker when standing on the interact tile", () => {
    const workers = computeDeskLayout(4).map((p, i) => ({ ...p, key: `w${i}` }));
    const w = workers[2];
    const hit = findAdjacentWorker(workers, w.interactX, w.interactY);
    assert.equal(hit?.key, "w2");
    // Standing one tile diagonally away: not adjacent (manhattan = 2).
    const miss = findAdjacentWorker(workers, w.deskX + 1, w.deskY + 1);
    assert.equal(miss, null);
});

test("summarizeJobs groups by skill and exposes queued/running counts and newest", () => {
    const jobs = [
        { id: 5, skillKey: "planner", status: "running" },
        { id: 4, skillKey: "planner", status: "queued"  },
        { id: 3, skillKey: "writer",  status: "done"    },
        { id: 2, skillKey: "writer",  status: "failed"  },
        { id: 1, skillKey: "default", status: "queued"  },
    ];
    const s = summarizeJobs(jobs);
    assert.equal(s.planner.queued, 1);
    assert.equal(s.planner.running, 1);
    assert.equal(s.planner.recent.id, 5, "recent should be the newest (first) for planner");
    assert.equal(s.writer.queued, 0);
    assert.equal(s.writer.running, 0);
    assert.equal(s.writer.recent.id, 3);
    assert.equal(s.default.queued, 1);
});
