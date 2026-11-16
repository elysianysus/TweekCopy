import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.RECURRENCE_TEST_BASE || "http://localhost:3001";

async function isServerUp() {
  try {
    const r = await fetch(BASE + "/api/health", { signal: AbortSignal.timeout(800) });
    if (r.ok) return true;
  } catch {}
  try {
    const r = await fetch(BASE + "/api/auth/user", { signal: AbortSignal.timeout(800) });
    return r.status === 401 || r.ok;
  } catch {
    return false;
  }
}

async function newUser() {
  const email = `recint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`;
  const r = await fetch(BASE + "/api/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "test12345", name: "RecInt", timezone: "Asia/Hong_Kong" }),
  }).then((r) => r.json());
  return r.token;
}

function authHeaders(token) {
  return { Authorization: "Bearer " + token, "Content-Type": "application/json" };
}

function fmtDate(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function todayStr() {
  return fmtDate(new Date());
}
function offsetStr(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return fmtDate(d);
}
function compareDate(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  if (ay !== by) return ay - by;
  if (am !== bm) return am - bm;
  return ad - bd;
}

test("integration: converting an existing task to a series initializes repeatTemplate from current fields", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Walk", color: "blue", description: "with dog", date: todayStr() }),
  }).then((r) => r.json());
  assert.equal(created.repeatTemplate, null, "non-recurring task should have null template");

  await fetch(BASE + `/api/tasks/${created.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ repeatPattern: "daily" }),
  });

  const list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const anchor = list.find((t) => t.id === created.id);
  assert.ok(anchor.repeatTemplate, "template should be initialized after conversion");
  const tpl = JSON.parse(anchor.repeatTemplate);
  assert.equal(tpl.name, "Walk");
  assert.equal(tpl.description, "with dog");
});

test("integration: editing one occurrence after conversion does not pollute newly materialized rows", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Drink water", date: todayStr(), repeatPattern: "daily" }),
  }).then((r) => r.json());

  // Rename the anchor row applyTo=one
  await fetch(BASE + `/api/tasks/${created.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ name: "Drink water (special)", applyTo: "one" }),
  });

  const list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const seriesRows = list.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  const anchor = seriesRows.find((t) => t.id === created.id);
  assert.equal(anchor.name, "Drink water (special)", "anchor row visibly renamed");
  const others = seriesRows.filter((t) => t.id !== created.id);
  for (const row of others) {
    assert.equal(row.name, "Drink water", "other materialized rows keep template name");
  }
  // Template itself should still be the original
  const tpl = JSON.parse(anchor.repeatTemplate);
  assert.equal(tpl.name, "Drink water", "repeatTemplate keeps original name");
});

test("integration: recurring tasks materialize beyond 14 days for month-range visibility", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Stretch", date: todayStr(), repeatPattern: "daily" }),
  }).then((r) => r.json());

  const list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const series = list.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  // Should reach at least 30 days ahead (Month view)
  assert.ok(series.length >= 30, `expected >= 30 occurrences for month view, got ${series.length}`);
});

test("integration: per-series horizonDays override produces occurrences past the 365-day default", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const { materializeSeriesForUser } = await import("../server/scheduler.js");
  const { db } = await import("../server/db.js");
  const { tasks } = await import("../server/schema.js");
  const { eq } = await import("drizzle-orm");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Long horizon", date: todayStr(), repeatPattern: "daily" }),
  }).then((r) => r.json());

  // Patch the series template to request a 500-day horizon and re-materialize
  // (no UI for this yet; we exercise the materializer directly to confirm the
  // server-side override pipeline honors values above the default cap).
  const longTpl = JSON.stringify({ name: "Long horizon", horizonDays: 500 });
  await db
    .update(tasks)
    .set({ repeatTemplate: longTpl })
    .where(eq(tasks.repeatSeriesId, created.repeatSeriesId));
  await materializeSeriesForUser(created.uid);

  const list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const series = list.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  // Default horizon caps near 365 days. The per-series override (500 days)
  // must produce occurrences past the old 365-occurrence ceiling.
  assert.ok(
    series.length > 365,
    `expected > 365 occurrences with horizonDays=500, got ${series.length}`,
  );
  const farOut = offsetStr(450);
  assert.ok(
    series.some((t) => t.date === farOut),
    `expected an occurrence on ${farOut}`,
  );
});

test("integration: recurring tasks materialize far enough for the Year view", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Daily review", date: todayStr(), repeatPattern: "daily" }),
  }).then((r) => r.json());

  const list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const series = list.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  // Year view needs visibility roughly a year out. With the new default
  // horizon (365 days) we expect well over the previous 62-day cutoff.
  assert.ok(
    series.length >= 180,
    `expected >= 180 occurrences for year view, got ${series.length}`,
  );

  // And concretely, an occurrence ~6 months out should exist.
  const sixMonthsOut = offsetStr(180);
  assert.ok(
    series.some((t) => t.date === sixMonthsOut),
    `expected an occurrence on ${sixMonthsOut}`,
  );
});

test("integration: future-scope correctly handles dates across month boundaries", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const anchor = todayStr();
  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Walk", date: anchor, repeatPattern: "daily" }),
  }).then((r) => r.json());

  const list1 = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const all = list1.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  // Pick a pivot far enough out that it crosses a month boundary from the anchor,
  // exercising the date-aware (non-lexical) future-scope filter.
  const pivotDate = offsetStr(35);
  const pivotRow = all.find((t) => t.date === pivotDate);
  assert.ok(pivotRow, `should have a ${pivotDate} occurrence`);

  await fetch(BASE + `/api/tasks/${pivotRow.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ name: "Walk (later)", applyTo: "future" }),
  });

  const list2 = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const after = list2.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  for (const row of after) {
    if (!row.date) continue;
    if (compareDate(row.date, pivotDate) >= 0) {
      assert.equal(row.name, "Walk (later)", `row ${row.date} should be renamed`);
    } else {
      assert.equal(row.name, "Walk", `row ${row.date} should NOT be renamed`);
    }
  }
});

test("integration: future-scope edit updates the latest row's template so newly materialized rows pick up the change", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Old name", date: todayStr(), repeatPattern: "daily" }),
  }).then((r) => r.json());

  const list1 = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const series1 = list1.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  // Edit a mid-series row (not the latest) with applyTo=future
  const sorted = series1.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const midRow = sorted[Math.floor(sorted.length / 2)];
  await fetch(BASE + `/api/tasks/${midRow.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ name: "New name", applyTo: "future" }),
  });

  const list2 = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const series2 = list2.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  const latest = series2.reduce((a, b) => (a.date > b.date ? a : b));
  // The latest row should have the new template so future-materialized rows get the new name
  assert.ok(latest.repeatTemplate, "latest row should have a template");
  assert.equal(JSON.parse(latest.repeatTemplate).name, "New name", "latest row's template carries the future-scope rename, so later materializations will use it");

  const list3 = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const series3 = list3.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  const rowsWithNewName = series3.filter((t) => JSON.parse(t.repeatTemplate || "{}").name === "New name");
  assert.ok(rowsWithNewName.length > 0, "at least some rows should carry the updated template");
});

test("integration: turning a recurring series off clears all recurrence fields on every row", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Sit", date: todayStr(), repeatPattern: "daily" }),
  }).then((r) => r.json());

  const before = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const sid = created.repeatSeriesId;
  const seriesBefore = before.filter((t) => t.repeatSeriesId === sid);
  assert.ok(seriesBefore.length > 1, "should have materialized a series");

  // Turn repeat off via PUT applyTo=series
  await fetch(BASE + `/api/tasks/${created.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ repeatPattern: null, applyTo: "series" }),
  });

  const after = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const formerlySeries = after.filter((t) => seriesBefore.some((s) => s.id === t.id));
  for (const row of formerlySeries) {
    assert.equal(row.repeatPattern, null, `row ${row.id} should have null repeatPattern`);
    assert.equal(row.repeatSeriesId, null, `row ${row.id} should have null repeatSeriesId`);
    assert.equal(row.repeatInterval, null, `row ${row.id} should have null repeatInterval`);
    assert.equal(row.repeatAnchorDate, null, `row ${row.id} should have null repeatAnchorDate`);
    assert.equal(row.repeatTemplate, null, `row ${row.id} should have null repeatTemplate`);
  }
});

test("integration: setting repeatEndedAt propagates to series and prunes later occurrences", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const anchor = todayStr();
  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Course", date: anchor, repeatPattern: "daily" }),
  }).then((r) => r.json());

  const before = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const sid = created.repeatSeriesId;
  const seriesBefore = before.filter((t) => t.repeatSeriesId === sid);
  assert.ok(seriesBefore.length > 3, "should have materialized several occurrences");

  const endDate = offsetStr(2);
  await fetch(BASE + `/api/tasks/${created.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ repeatEndedAt: endDate, applyTo: "series" }),
  });

  const after = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const seriesAfter = after.filter((t) => t.repeatSeriesId === sid);
  assert.ok(seriesAfter.length > 0, "series should still have rows up to end date");
  for (const row of seriesAfter) {
    assert.equal(row.repeatEndedAt, endDate, `row ${row.id} should carry the new end date`);
    assert.ok(compareDate(row.date, endDate) <= 0, `row ${row.id} (${row.date}) should not be after ${endDate}`);
  }
});

test("integration: clearing repeatEndedAt re-opens the series so the materializer fills it back in", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Limited", date: todayStr(), repeatPattern: "daily" }),
  }).then((r) => r.json());

  const endDate = offsetStr(1);
  await fetch(BASE + `/api/tasks/${created.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ repeatEndedAt: endDate, applyTo: "series" }),
  });

  const limited = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const limitedSeries = limited.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  assert.ok(limitedSeries.every((r) => compareDate(r.date, endDate) <= 0));

  await fetch(BASE + `/api/tasks/${created.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ repeatEndedAt: null, applyTo: "series" }),
  });

  const reopened = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const reopenedSeries = reopened.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  for (const r of reopenedSeries) {
    assert.equal(r.repeatEndedAt, null, `row ${r.id} should have repeatEndedAt cleared`);
  }
  assert.ok(reopenedSeries.length > limitedSeries.length, "materializer should refill the series");
});

test("integration: applyTo='one' with repeatEndedAt updates only that row and does not prune other instances", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Scoped", date: todayStr(), repeatPattern: "daily" }),
  }).then((r) => r.json());

  const before = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const sid = created.repeatSeriesId;
  const seriesBefore = before.filter((t) => t.repeatSeriesId === sid);
  assert.ok(seriesBefore.length > 3, "should have materialized several occurrences");
  const otherIds = seriesBefore.filter((r) => r.id !== created.id).map((r) => r.id);

  // Sending applyTo:'one' should NOT propagate or prune.
  await fetch(BASE + `/api/tasks/${created.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ repeatEndedAt: offsetStr(1), applyTo: "one" }),
  });

  const after = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const remainingIds = new Set(after.map((r) => r.id));
  for (const id of otherIds) {
    assert.ok(remainingIds.has(id), `row ${id} should still exist (no prune for applyTo:'one')`);
  }
  const others = after.filter((t) => t.repeatSeriesId === sid && t.id !== created.id);
  for (const r of others) {
    assert.equal(r.repeatEndedAt, null, `row ${r.id} should not have repeatEndedAt set when scope was 'one'`);
  }
});

test("integration: rejecting a repeatEndedAt earlier than the anchor date returns 400", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Anchored", date: todayStr(), repeatPattern: "daily" }),
  }).then((r) => r.json());

  const res = await fetch(BASE + `/api/tasks/${created.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ repeatEndedAt: offsetStr(-7), applyTo: "series" }),
  });
  assert.equal(res.status, 400, "end date before anchor should be rejected");
});

test("integration: PUT horizonDays with applyTo=series writes the override into the template and produces extra occurrences", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Long horizon UI", date: todayStr(), repeatPattern: "daily" }),
  }).then((r) => r.json());

  // Default horizon is 365, so before the change we should NOT see day +450.
  let list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  let series = list.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  const farOut = offsetStr(450);
  assert.ok(
    !series.some((t) => t.date === farOut),
    `should not yet have an occurrence at ${farOut}`,
  );

  // Push horizon out to 500 days through the public PUT endpoint.
  const updateRes = await fetch(BASE + `/api/tasks/${created.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ horizonDays: 500, applyTo: "series" }),
  });
  assert.equal(updateRes.status, 200, "PUT horizonDays should succeed");

  list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  series = list.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  assert.ok(
    series.length > 365,
    `expected > 365 occurrences after horizonDays=500, got ${series.length}`,
  );
  assert.ok(
    series.some((t) => t.date === farOut),
    `expected an occurrence on ${farOut} after horizon override`,
  );

  // The override must live inside the template JSON (it is not a tasks column).
  const anchor = series.find((t) => t.id === created.id);
  const tpl = JSON.parse(anchor.repeatTemplate);
  assert.equal(tpl.horizonDays, 500, "template should carry horizonDays=500");
  assert.equal(anchor.horizonDays, undefined, "horizonDays must not leak onto the row");
});

test("integration: PUT horizonDays with applyTo=one still folds the override into the series template", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Horizon scope=one", date: todayStr(), repeatPattern: "daily" }),
  }).then((r) => r.json());

  const updateRes = await fetch(BASE + `/api/tasks/${created.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ horizonDays: 60, applyTo: "one" }),
  });
  assert.equal(updateRes.status, 200, "PUT horizonDays applyTo=one should succeed");

  const list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const series = list.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  for (const row of series) {
    const tpl = JSON.parse(row.repeatTemplate);
    assert.equal(tpl.horizonDays, 60, `row ${row.id} template should carry horizonDays=60`);
  }
});

test("integration: PUT horizonDays=null clears the override and falls back to the global default", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      name: "Clear horizon",
      date: todayStr(),
      repeatPattern: "daily",
      horizonDays: 60,
    }),
  }).then((r) => r.json());

  // Sanity: the override is in the template after creation.
  let tpl = JSON.parse(created.repeatTemplate);
  assert.equal(tpl.horizonDays, 60, "POST should seed horizonDays=60");

  // Clear it through the public PUT endpoint.
  const res = await fetch(BASE + `/api/tasks/${created.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ horizonDays: null, applyTo: "series" }),
  });
  assert.equal(res.status, 200, "PUT horizonDays=null should succeed");

  const list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const series = list.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  for (const row of series) {
    tpl = JSON.parse(row.repeatTemplate);
    // null clears the override; absent or null means "use the global default".
    assert.ok(
      tpl.horizonDays == null,
      `row ${row.id} template horizonDays should be cleared, got ${tpl.horizonDays}`,
    );
  }
});

test("integration: PUT horizonDays out of range gets clamped into the safe window", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Clamp horizon", date: todayStr(), repeatPattern: "daily" }),
  }).then((r) => r.json());

  // Way above MAX (730) — server should clamp to 730 instead of erroring.
  const res = await fetch(BASE + `/api/tasks/${created.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ horizonDays: 5000, applyTo: "series" }),
  });
  assert.equal(res.status, 200);

  const list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const anchor = list.find((t) => t.id === created.id);
  const tpl = JSON.parse(anchor.repeatTemplate);
  assert.equal(tpl.horizonDays, 730, "5000 should be clamped to MAX_HORIZON_DAYS=730");
});

test("integration: POST recurring task with horizonDays initializes the override in the template", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      name: "Yearly review",
      date: todayStr(),
      repeatPattern: "monthly",
      horizonDays: 720,
    }),
  }).then((r) => r.json());

  assert.ok(created.repeatTemplate, "template should be initialized");
  const tpl = JSON.parse(created.repeatTemplate);
  assert.equal(tpl.horizonDays, 720, "POST should round-trip horizonDays into the template");
  assert.equal(created.horizonDays, undefined, "horizonDays must not leak onto the row");
});

test("integration: toggle with scope=series propagates done to all occurrences", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Read", date: todayStr(), repeatPattern: "daily" }),
  }).then((r) => r.json());

  await fetch(BASE + `/api/tasks/${created.id}/toggle?scope=series`, { method: "PUT", headers: H });

  const list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const series = list.filter((t) => t.repeatSeriesId === created.repeatSeriesId);
  assert.ok(series.length > 0);
  for (const row of series) {
    assert.equal(row.done, true, `row ${row.id} (${row.date}) should be done`);
  }
});

test("integration: POST /api/tasks accepts repeatEndedAt at creation", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const endStr = offsetStr(10);
  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      name: "Bounded series",
      date: todayStr(),
      repeatPattern: "daily",
      repeatEndedAt: endStr,
    }),
  }).then((r) => r.json());

  assert.equal(created.repeatEndedAt, endStr, "anchor row stores end date");
  const list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const series = list.filter((row) => row.repeatSeriesId === created.repeatSeriesId);
  assert.ok(series.length >= 1);
  for (const row of series) {
    assert.ok(compareDate(row.date, endStr) <= 0, `row ${row.date} should be on/before ${endStr}`);
    assert.equal(row.repeatEndedAt, endStr);
  }

  // Reject invalid: end before anchor
  const bad = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      name: "Bad",
      date: todayStr(),
      repeatPattern: "daily",
      repeatEndedAt: offsetStr(-5),
    }),
  });
  assert.equal(bad.status, 400, "end-before-anchor should be rejected");
});

test("integration: three-way scope edits via PUT applyTo=one|future|series", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Original", date: offsetStr(-2), repeatPattern: "daily" }),
  }).then((r) => r.json());

  // Find a row at today's date and at +1
  let list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const series = () => list.filter((r) => r.repeatSeriesId === created.repeatSeriesId);
  const todayRow = series().find((r) => r.date === todayStr());
  assert.ok(todayRow, "should have a today row");

  // applyTo=one on today row
  await fetch(BASE + `/api/tasks/${todayRow.id}?applyTo=one`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ name: "Just-today" }),
  });
  list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const after1 = series();
  const onlyToday = after1.filter((r) => r.name === "Just-today");
  assert.equal(onlyToday.length, 1);
  assert.equal(onlyToday[0].date, todayStr());

  // applyTo=future on today row
  await fetch(BASE + `/api/tasks/${todayRow.id}?applyTo=future`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ name: "Future-rename" }),
  });
  list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  for (const row of series()) {
    if (compareDate(row.date, todayStr()) >= 0) {
      assert.equal(row.name, "Future-rename", `future row ${row.date}`);
    } else {
      assert.equal(row.name, "Original", `past row ${row.date} should be untouched`);
    }
  }

  // applyTo=series
  await fetch(BASE + `/api/tasks/${created.id}?applyTo=series`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ name: "All-rename" }),
  });
  list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  for (const row of series()) {
    assert.equal(row.name, "All-rename", `row ${row.date}`);
  }
});

test("integration: skip date removes occurrence and un-skip restores it", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Yoga", date: todayStr(), repeatPattern: "daily" }),
  }).then((r) => r.json());

  let list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const series = () => list.filter((r) => r.repeatSeriesId === created.repeatSeriesId);
  const targetDate = offsetStr(1);
  const targetRow = series().find((r) => r.date === targetDate);
  assert.ok(targetRow, "tomorrow row should be materialized");

  // Add skip
  const addRes = await fetch(BASE + `/api/tasks/${created.id}/repeat-exceptions`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ date: targetDate }),
  });
  assert.equal(addRes.status, 200);

  list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  assert.ok(!series().find((r) => r.date === targetDate), "occurrence should be removed");

  const exceptions = await fetch(BASE + `/api/tasks/${created.id}/repeat-exceptions`, { headers: H }).then((r) => r.json());
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].date, targetDate);

  // Un-skip
  const delRes = await fetch(BASE + `/api/tasks/${created.id}/repeat-exceptions/${targetDate}`, {
    method: "DELETE",
    headers: H,
  });
  assert.equal(delRes.status, 200);

  list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  assert.ok(series().find((r) => r.date === targetDate), "occurrence should be re-materialized");

  const exceptions2 = await fetch(BASE + `/api/tasks/${created.id}/repeat-exceptions`, { headers: H }).then((r) => r.json());
  assert.equal(exceptions2.length, 0);
});

test("integration: update repeat anchor re-aligns future occurrences and preserves past", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");
  const token = await newUser();
  const H = authHeaders(token);

  const created = await fetch(BASE + "/api/tasks", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "Stretch", date: offsetStr(-3), repeatPattern: "every_n_days", repeatInterval: 2 }),
  }).then((r) => r.json());

  let list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const series = () => list.filter((r) => r.repeatSeriesId === created.repeatSeriesId);
  const pastDate = offsetStr(-3);
  const pastRow = series().find((r) => r.date === pastDate);
  assert.ok(pastRow);
  // Mark the past row done so it's preserved through the anchor change
  await fetch(BASE + `/api/tasks/${pastRow.id}/toggle?scope=one`, { method: "PUT", headers: H });

  const newAnchor = todayStr();
  const res = await fetch(BASE + `/api/tasks/${created.id}/repeat-anchor`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ repeatAnchorDate: newAnchor }),
  });
  assert.equal(res.status, 200);

  list = await fetch(BASE + "/api/tasks", { headers: H }).then((r) => r.json());
  const after = series();
  for (const row of after) {
    assert.equal(row.repeatAnchorDate, newAnchor, `row ${row.date} should have new anchor`);
  }
  // Past done row should still be present
  assert.ok(after.find((r) => r.date === pastDate && r.done), "past done row should be preserved");
  // Future rows should align with new anchor and cadence (every 2 days)
  for (const row of after) {
    if (compareDate(row.date, newAnchor) >= 0) {
      const [ay, am, ad] = newAnchor.split("-").map(Number);
      const [ry, rm, rd] = row.date.split("-").map(Number);
      const diff = Math.round((Date.UTC(ry, rm - 1, rd) - Date.UTC(ay, am - 1, ad)) / 86400000);
      assert.equal(diff % 2, 0, `row ${row.date} should align with every-2-day cadence from ${newAnchor}`);
    }
  }
});
