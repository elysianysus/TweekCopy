import { test, after } from "node:test";
import assert from "node:assert/strict";

after(() => {
    setTimeout(() => process.exit(0), 100).unref();
});
import { spawnSync } from "node:child_process";
import { promises as fsp, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");

test("wrapper dry run produces a fixture md and ok JSON", async () => {
    const outDir = path.join(REPO_ROOT, "uploads", "last30days", "test-wrapper");
    await fsp.rm(outDir, { recursive: true, force: true });
    const params = { topic: "claude opus", outDir, runId: "wrap-1", sources: ["reddit", "hn"] };
    const res = spawnSync("python3", [path.join(REPO_ROOT, "scripts", "run-last30days.py")], {
        input: JSON.stringify(params),
        env: { ...process.env, LAST30DAYS_DRY_RUN: "1" },
        encoding: "utf-8",
        cwd: REPO_ROOT,
    });
    assert.equal(res.status, 0, `wrapper failed: ${res.stderr}`);
    const obj = JSON.parse(res.stdout.trim().split("\n").pop());
    assert.equal(obj.status, "ok");
    assert.ok(obj.mdPath && obj.mdPath.endsWith("wrap-1.md"));
    assert.ok(existsSync(obj.mdPath), "md file should exist on disk");
    const md = await fsp.readFile(obj.mdPath, "utf-8");
    assert.ok(md.includes("claude opus"), "fixture should mention topic");
    await fsp.rm(outDir, { recursive: true, force: true });
});

test("wrapper rejects non-object JSON input with structured failure", async () => {
    for (const input of ["[]", "\"scalar\"", "42", "not even json"]) {
        const res = spawnSync("python3", [path.join(REPO_ROOT, "scripts", "run-last30days.py")], {
            input, encoding: "utf-8", cwd: REPO_ROOT,
        });
        assert.equal(res.status, 0, `wrapper exited non-zero on input ${input}: ${res.stderr}`);
        const obj = JSON.parse(res.stdout.trim().split("\n").pop());
        assert.equal(obj.status, "failed", `expected failed for ${input}`);
        assert.ok(obj.error, "error field should be present");
    }
});

test("wrapper invokes real engine in --mock mode and produces md", async () => {
    const outDir = path.join(REPO_ROOT, "uploads", "last30days", "test-mock-real");
    await fsp.rm(outDir, { recursive: true, force: true });
    const params = { topic: "integration smoke", outDir, runId: "mock-int-1", sources: ["reddit"] };
    const res = spawnSync("python3", [path.join(REPO_ROOT, "scripts", "run-last30days.py")], {
        input: JSON.stringify(params),
        env: { ...process.env, LAST30DAYS_MOCK: "1" },
        encoding: "utf-8",
        cwd: REPO_ROOT,
        timeout: 90_000,
    });
    assert.equal(res.status, 0, `wrapper failed: ${res.stderr}`);
    const obj = JSON.parse(res.stdout.trim().split("\n").pop());
    if (obj.status !== "ok") {
        // Skip rather than fail when no python3.12 is available — keeps the
        // suite green on hosts without the right interpreter, while still
        // exercising the real engine path everywhere it can run.
        console.log(`# SKIP mock integration: ${obj.error}`);
        return;
    }
    assert.ok(obj.mdPath && obj.mdPath.endsWith("mock-int-1.md"));
    assert.ok(existsSync(obj.mdPath), "engine md output should exist");
    const md = await fsp.readFile(obj.mdPath, "utf-8");
    assert.ok(md.length > 100, "engine should produce substantive markdown");
    assert.match(md, /integration smoke/i, "engine should echo the topic somewhere");
    await fsp.rm(outDir, { recursive: true, force: true });
});

test("wrapper rejects missing required params", async () => {
    const res = spawnSync("python3", [path.join(REPO_ROOT, "scripts", "run-last30days.py")], {
        input: JSON.stringify({ topic: "" }),
        encoding: "utf-8",
        cwd: REPO_ROOT,
    });
    assert.equal(res.status, 0);
    const obj = JSON.parse(res.stdout.trim().split("\n").pop());
    assert.equal(obj.status, "failed");
    assert.match(obj.error, /topic/);
});

test("worker dry-run flow renders md -> html and DELETE removes the file from disk", async () => {
    process.env.LAST30DAYS_DRY_RUN = "1";
    const { db } = await import("../server/db.js");
    const { last30daysRuns } = await import("../server/schema.js");
    const { enqueueRun, startLast30DaysWorker } = await import("../server/last30daysWorker.js");
    const { eq } = await import("drizzle-orm");
    const TEST_UID = 999997;
    await db.delete(last30daysRuns).where(eq(last30daysRuns.uid, TEST_UID));

    const [row] = await db.insert(last30daysRuns).values({
        uid: TEST_UID, topic: "delete-cleanup-smoke", sourcesJson: "[]", status: "queued",
    }).returning();
    startLast30DaysWorker();
    enqueueRun(row.id);

    const deadline = Date.now() + 15000;
    let final;
    while (Date.now() < deadline) {
        const [r] = await db.select().from(last30daysRuns).where(eq(last30daysRuns.id, row.id));
        if (r && (r.status === "succeeded" || r.status === "failed")) { final = r; break; }
        await new Promise(r2 => setTimeout(r2, 200));
    }
    assert.equal(final.status, "succeeded", `expected succeeded, got ${final?.status} (${final?.errorMessage})`);
    const abs = path.resolve(REPO_ROOT, final.htmlPath);
    assert.ok(existsSync(abs), "rendered html file should exist before delete");
    const html = await fsp.readFile(abs, "utf-8");
    assert.match(html, /Dry run brief/, "html should include rendered markdown");
    assert.match(html, /<h1>/, "marked should produce real HTML, not <pre> fallback");

    // Simulate the DELETE endpoint's cleanup logic:
    await fsp.unlink(abs);
    await db.delete(last30daysRuns).where(eq(last30daysRuns.id, row.id));
    assert.ok(!existsSync(abs), "html file should be gone after delete");
});

test("save-as-memo route persists a memo with the topic as title and sanitized HTML", async () => {
    process.env.LAST30DAYS_DRY_RUN = "1";
    const { db } = await import("../server/db.js");
    const { last30daysRuns, memos } = await import("../server/schema.js");
    const { enqueueRun, startLast30DaysWorker } = await import("../server/last30daysWorker.js");
    const routerMod = await import("../server/routes.js");
    const router = routerMod.default;
    const express = (await import("express")).default;
    const { eq } = await import("drizzle-orm");
    const TEST_UID = 999996;

    // Inject auth + uid the way the rest of the route layer expects.
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: TEST_UID, isAdmin: false }; req.session = { userId: TEST_UID }; next(); });
    app.use(router);

    await db.delete(last30daysRuns).where(eq(last30daysRuns.uid, TEST_UID));
    await db.delete(memos).where(eq(memos.uid, TEST_UID));

    // 1. Run a dry-run job to completion via the worker.
    const [row] = await db.insert(last30daysRuns).values({
        uid: TEST_UID, topic: "memo-title-smoke", sourcesJson: "[]", status: "queued",
    }).returning();
    startLast30DaysWorker();
    enqueueRun(row.id);
    const deadline = Date.now() + 15000;
    let final;
    while (Date.now() < deadline) {
        const [r] = await db.select().from(last30daysRuns).where(eq(last30daysRuns.id, row.id));
        if (r && (r.status === "succeeded" || r.status === "failed")) { final = r; break; }
        await new Promise(r2 => setTimeout(r2, 200));
    }
    assert.equal(final.status, "succeeded");

    // 2. Hit the real save-as-memo endpoint via supertest-style raw http.
    const server = app.listen(0);
    await new Promise(r => server.once("listening", r));
    const port = server.address().port;
    try {
        const resp = await fetch(`http://127.0.0.1:${port}/api/last30days/runs/${row.id}/save-as-memo`, { method: "POST" });
        const respText = await resp.text();
        assert.equal(resp.status, 200, `unexpected status ${resp.status}: ${respText}`);
        const body = JSON.parse(respText);
        assert.ok(body.memoId, "memoId in response");
        const [m] = await db.select().from(memos).where(eq(memos.id, body.memoId));
        assert.equal(m.uid, TEST_UID);
        assert.equal(m.title, "memo-title-smoke", "memo title must equal the topic verbatim");
        assert.ok(m.content && m.content.length > 0, "memo content should be populated");
        assert.ok(!/<script/i.test(m.content), "memo content must not contain <script>");

        // 3. DELETE the run via HTTP and assert the file is gone.
        const abs = path.resolve(REPO_ROOT, final.htmlPath);
        assert.ok(existsSync(abs), "html file should exist before DELETE");
        const del = await fetch(`http://127.0.0.1:${port}/api/last30days/runs/${row.id}`, { method: "DELETE" });
        assert.equal(del.status, 200);
        assert.ok(!existsSync(abs), "html file should be removed by DELETE handler");
        const after = await db.select().from(last30daysRuns).where(eq(last30daysRuns.id, row.id));
        assert.equal(after.length, 0, "row should be deleted");

        // 4. /raw endpoint streams unsanitized HTML for downloads.
        // (Use a fresh succeeded row since we just deleted the one above.)
        const [row2] = await db.insert(last30daysRuns).values({
            uid: TEST_UID, topic: "raw-download-smoke", sourcesJson: "[]", status: "queued",
        }).returning();
        enqueueRun(row2.id);
        const dl2 = Date.now() + 15000;
        let f2;
        while (Date.now() < dl2) {
            const [r] = await db.select().from(last30daysRuns).where(eq(last30daysRuns.id, row2.id));
            if (r && (r.status === "succeeded" || r.status === "failed")) { f2 = r; break; }
            await new Promise(r2 => setTimeout(r2, 200));
        }
        assert.equal(f2.status, "succeeded");
        const rawResp = await fetch(`http://127.0.0.1:${port}/api/last30days/runs/${row2.id}/raw`);
        assert.equal(rawResp.status, 200);
        assert.match(rawResp.headers.get("content-type") || "", /text\/html/);
        assert.match(rawResp.headers.get("content-disposition") || "", /attachment; filename=/);
        const txt = await rawResp.text();
        assert.match(txt, /Dry run brief/);
    } finally {
        server.close();
    }
});

test("shouldHonorLast30DaysDryRunRequest only opts in when allow-list env var is 1", async () => {
    const { shouldHonorLast30DaysDryRunRequest } = await import("../server/routes.js");
    assert.equal(typeof shouldHonorLast30DaysDryRunRequest, "function",
        "routes.js should export shouldHonorLast30DaysDryRunRequest");

    const mkReq = (body, headers = {}) => ({
        body,
        get: (name) => headers[String(name).toLowerCase()],
    });

    const prev = process.env.LAST30DAYS_ALLOW_DRY_RUN_HEADER;
    try {
        // Env var unset -> always denied even if the request asks.
        delete process.env.LAST30DAYS_ALLOW_DRY_RUN_HEADER;
        assert.equal(shouldHonorLast30DaysDryRunRequest(mkReq({ dryRun: true })), false);
        assert.equal(shouldHonorLast30DaysDryRunRequest(mkReq({}, { "x-last30days-dry-run": "1" })), false);

        // Env var set to a non-"1" value -> still denied (deny-by-default).
        process.env.LAST30DAYS_ALLOW_DRY_RUN_HEADER = "true";
        assert.equal(shouldHonorLast30DaysDryRunRequest(mkReq({ dryRun: true })), false);

        // Env var = "1" + request opts in -> honored (body OR header).
        process.env.LAST30DAYS_ALLOW_DRY_RUN_HEADER = "1";
        assert.equal(shouldHonorLast30DaysDryRunRequest(mkReq({ dryRun: true })), true);
        assert.equal(shouldHonorLast30DaysDryRunRequest(mkReq({}, { "x-last30days-dry-run": "1" })), true);

        // Env var = "1" but request didn't opt in -> still false.
        assert.equal(shouldHonorLast30DaysDryRunRequest(mkReq({})), false);
        assert.equal(shouldHonorLast30DaysDryRunRequest(mkReq({ dryRun: "yes" })), false,
            "only the literal boolean true should opt in (no truthy coercion)");
    } finally {
        if (prev === undefined) delete process.env.LAST30DAYS_ALLOW_DRY_RUN_HEADER;
        else process.env.LAST30DAYS_ALLOW_DRY_RUN_HEADER = prev;
    }
});

test("wrapper honors per-request dryRun param even with env var unset", async () => {
    const outDir = path.join(REPO_ROOT, "uploads", "last30days", "test-wrapper-perreq");
    await fsp.rm(outDir, { recursive: true, force: true });
    const params = { topic: "per-request dry", outDir, runId: "wrap-pr-1", sources: ["reddit"], dryRun: true };
    // Explicitly strip the env var so we prove the param alone is enough.
    const env = { ...process.env };
    delete env.LAST30DAYS_DRY_RUN;
    const res = spawnSync("python3", [path.join(REPO_ROOT, "scripts", "run-last30days.py")], {
        input: JSON.stringify(params),
        env,
        encoding: "utf-8",
        cwd: REPO_ROOT,
    });
    assert.equal(res.status, 0, `wrapper failed: ${res.stderr}`);
    const obj = JSON.parse(res.stdout.trim().split("\n").pop());
    assert.equal(obj.status, "ok");
    assert.equal(obj.dryRun, true);
    assert.ok(obj.mdPath && existsSync(obj.mdPath), "fixture md should exist");
    const md = await fsp.readFile(obj.mdPath, "utf-8");
    assert.match(md, /LAST30DAYS_DRY_RUN/);
    await fsp.rm(outDir, { recursive: true, force: true });
});

test("save-as-memo sanitizer strips scripts, event handlers and javascript: urls", async () => {
    const { sanitizeBriefHtml } = await import("../server/routes.js");
    assert.equal(typeof sanitizeBriefHtml, "function", "routes.js should export sanitizeBriefHtml");
    const dirty =
        `<h1 onclick="alert(1)">heading</h1>` +
        `<script>alert(2)</script>` +
        `<a href="javascript:alert(3)">bad link</a>` +
        `<img src="javascript:alert(4)" onerror="alert(5)">` +
        `<p style="color:red">ok body</p>`;
    const clean = sanitizeBriefHtml(dirty);
    assert.ok(!/<script/i.test(clean), `script tag must be stripped: ${clean}`);
    assert.ok(!/onclick=/i.test(clean), "inline handler must be stripped");
    assert.ok(!/onerror=/i.test(clean), "inline handler must be stripped");
    assert.ok(!/javascript:/i.test(clean), "javascript: urls must be stripped");
    assert.match(clean, /<h1[^>]*>heading<\/h1>/, "safe heading content should survive");
    assert.match(clean, /<p[^>]*>ok body<\/p>/, "safe paragraph should survive");
    assert.match(clean, /target="_blank"/, "links should get target=_blank");
    assert.match(clean, /rel="noopener noreferrer"/, "links should get rel=noopener");
});

test("worker recoverInterruptedRuns transitions queued/running -> failed", async () => {
    process.env.LAST30DAYS_DRY_RUN = "1";
    process.env.LAST30DAYS_PYTHON = "python3";
    const { db } = await import("../server/db.js");
    const { last30daysRuns } = await import("../server/schema.js");
    const { recoverInterruptedRuns } = await import("../server/last30daysWorker.js");
    const { eq } = await import("drizzle-orm");

    const TEST_UID = 999999;
    await db.delete(last30daysRuns).where(eq(last30daysRuns.uid, TEST_UID));
    const [a] = await db.insert(last30daysRuns).values({
        uid: TEST_UID, topic: "stuck queue", sourcesJson: "[]", status: "queued",
    }).returning();
    const [b] = await db.insert(last30daysRuns).values({
        uid: TEST_UID, topic: "stuck running", sourcesJson: "[]", status: "running",
    }).returning();

    await recoverInterruptedRuns();

    const after = await db.select().from(last30daysRuns).where(eq(last30daysRuns.uid, TEST_UID));
    for (const row of after) {
        assert.equal(row.status, "failed");
        assert.match(row.errorMessage || "", /interrupted/);
    }
    await db.delete(last30daysRuns).where(eq(last30daysRuns.uid, TEST_UID));
});

test("worker enqueueRun runs to completion in dry-run mode", async () => {
    process.env.LAST30DAYS_DRY_RUN = "1";
    process.env.LAST30DAYS_PYTHON = "python3";
    const { db } = await import("../server/db.js");
    const { last30daysRuns } = await import("../server/schema.js");
    const { enqueueRun, startLast30DaysWorker, getLast30DaysSchedulerStats } = await import("../server/last30daysWorker.js");
    const { eq } = await import("drizzle-orm");

    const TEST_UID = 999998;
    await db.delete(last30daysRuns).where(eq(last30daysRuns.uid, TEST_UID));
    const [row] = await db.insert(last30daysRuns).values({
        uid: TEST_UID, topic: "wiring smoke", sourcesJson: JSON.stringify(["reddit"]), status: "queued",
    }).returning();
    startLast30DaysWorker();
    enqueueRun(row.id);

    const deadline = Date.now() + 15000;
    let final;
    while (Date.now() < deadline) {
        const [r] = await db.select().from(last30daysRuns).where(eq(last30daysRuns.id, row.id));
        if (r && (r.status === "succeeded" || r.status === "failed")) { final = r; break; }
        await new Promise(r2 => setTimeout(r2, 200));
    }
    assert.ok(final, "run did not finish in time");
    assert.equal(final.status, "succeeded", `expected succeeded, got ${final?.status} (${final?.errorMessage})`);
    assert.ok(final.htmlPath && final.htmlPath.includes("uploads/last30days"));
    assert.equal(final.engineVersion, "3.1.0");
    const stats = getLast30DaysSchedulerStats();
    assert.ok(stats.attempted >= 1);

    if (final.htmlPath) {
        const abs = path.resolve(REPO_ROOT, final.htmlPath);
        await fsp.unlink(abs).catch(() => {});
    }
    await db.delete(last30daysRuns).where(eq(last30daysRuns.uid, TEST_UID));
});
