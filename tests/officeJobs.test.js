import { test, after } from "node:test";
import assert from "node:assert/strict";

after(() => { setTimeout(() => process.exit(0), 100).unref(); });

import { eq, and } from "drizzle-orm";

const TEST_UID = 999990;

async function loadModules() {
    const { db } = await import("../server/db.js");
    const schema = await import("../server/schema.js");
    const office = await import("../server/officeJobs.js");
    return { db, schema, office };
}

async function cleanup(db, schema, uid = TEST_UID) {
    await db.delete(schema.officeJobs).where(eq(schema.officeJobs.uid, uid));
    await db.delete(schema.museMessages).where(eq(schema.museMessages.uid, uid));
    await db.delete(schema.museConversations).where(eq(schema.museConversations.uid, uid));
    await db.delete(schema.tasks).where(eq(schema.tasks.uid, uid));
    // memo_tags rows are tied to memos by id, so wipe them via a join-style
    // subquery before nuking memos themselves.
    const userMemos = await db.select({ id: schema.memos.id })
        .from(schema.memos).where(eq(schema.memos.uid, uid));
    for (const m of userMemos) {
        await db.delete(schema.memoTags).where(eq(schema.memoTags.memoId, m.id));
    }
    await db.delete(schema.memos).where(eq(schema.memos.uid, uid));
}

async function waitForJob(db, schema, jobId, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const [r] = await db.select().from(schema.officeJobs).where(eq(schema.officeJobs.id, jobId));
        if (r && (r.status === "done" || r.status === "failed")) return r;
        await new Promise(r2 => setTimeout(r2, 100));
    }
    throw new Error("job did not finish in time");
}

test("enqueueOfficeJob runs to done, persists assistant message, and parses draft task", async () => {
    const { db, schema, office } = await loadModules();
    await cleanup(db, schema);

    const original = office.__testHooks.llm;
    office.__testHooks.llm = async () =>
        "Here's a plan:\ndraft task: 09:00 Write the office spec\ndraft task: Review pull requests\nThat sets you up nicely.";
    try {
        office.startOfficeJobsWorker();
        const job = await office.enqueueOfficeJob({
            uid: TEST_UID, skillKey: "planner", actionType: "draft_tasks", argument: "tomorrow's focus",
        });
        const final = await waitForJob(db, schema, job.id);
        assert.equal(final.status, "done", `expected done, got ${final.status}: ${final.errorMessage}`);
        assert.ok(final.result && final.result.includes("draft task:"));
        assert.ok(final.conversationId, "should record conversationId");
        assert.ok(final.assistantMessageId, "should record assistantMessageId");

        // Conversation + 2 messages (user request + assistant) saved.
        const convos = await db.select().from(schema.museConversations).where(eq(schema.museConversations.uid, TEST_UID));
        assert.equal(convos.length, 1);
        assert.equal(convos[0].title, "Office · planner");
        const msgs = await db.select().from(schema.museMessages).where(eq(schema.museMessages.conversationId, convos[0].id));
        assert.equal(msgs.length, 2);
        assert.ok(msgs.some(m => m.role === "user"));
        assert.ok(msgs.some(m => m.role === "assistant"));

        // The two `draft task:` lines should each become a task.
        const ts = await db.select().from(schema.tasks).where(eq(schema.tasks.uid, TEST_UID));
        assert.equal(ts.length, 2, `expected 2 tasks, got ${ts.length}`);
        assert.ok(ts.some(t => t.name === "Write the office spec" && t.startTime === "09:00"));
        assert.ok(ts.some(t => t.name === "Review pull requests"));
    } finally {
        office.__testHooks.llm = original;
        office.stopOfficeJobsWorker();
        await cleanup(db, schema);
    }
});

test("enqueueOfficeJob with draft_memo creates a memo from the parsed line", async () => {
    const { db, schema, office } = await loadModules();
    await cleanup(db, schema);
    const original = office.__testHooks.llm;
    office.__testHooks.llm = async () =>
        "Here is a quick draft for you.\ndraft memo: Office launch — small pixel office launched today, feels good.";
    try {
        office.startOfficeJobsWorker();
        const job = await office.enqueueOfficeJob({
            uid: TEST_UID, skillKey: "writer", actionType: "draft_memo", argument: "office launch",
        });
        const final = await waitForJob(db, schema, job.id);
        assert.equal(final.status, "done");
        const ms = await db.select().from(schema.memos).where(eq(schema.memos.uid, TEST_UID));
        assert.equal(ms.length, 1);
        assert.match(ms[0].content, /Office launch/);
    } finally {
        office.__testHooks.llm = original;
        office.stopOfficeJobsWorker();
        await cleanup(db, schema);
    }
});

test("LLM failure marks the job failed with errorMessage and no side effects", async () => {
    const { db, schema, office } = await loadModules();
    await cleanup(db, schema);
    const original = office.__testHooks.llm;
    office.__testHooks.llm = async () => { throw new Error("simulated upstream outage"); };
    try {
        office.startOfficeJobsWorker();
        const job = await office.enqueueOfficeJob({
            uid: TEST_UID, skillKey: "default", actionType: "quick_research", argument: "vector dbs",
        });
        const final = await waitForJob(db, schema, job.id);
        assert.equal(final.status, "failed");
        assert.match(final.errorMessage || "", /simulated upstream outage/);
        const ts = await db.select().from(schema.tasks).where(eq(schema.tasks.uid, TEST_UID));
        assert.equal(ts.length, 0);
    } finally {
        office.__testHooks.llm = original;
        office.stopOfficeJobsWorker();
        await cleanup(db, schema);
    }
});

test("recoverInterruptedOfficeJobs flips queued + running rows to failed", async () => {
    const { db, schema, office } = await loadModules();
    await cleanup(db, schema);
    try {
        await db.insert(schema.officeJobs).values([
            { uid: TEST_UID, skillKey: "default", actionType: "draft_tasks", status: "queued" },
            { uid: TEST_UID, skillKey: "default", actionType: "draft_tasks", status: "running" },
        ]);
        await office.recoverInterruptedOfficeJobs();
        const rows = await db.select().from(schema.officeJobs).where(eq(schema.officeJobs.uid, TEST_UID));
        assert.equal(rows.length, 2);
        for (const r of rows) {
            assert.equal(r.status, "failed");
            assert.match(r.errorMessage || "", /interrupted/);
        }
    } finally {
        await cleanup(db, schema);
    }
});

test("two jobs for the same user but different skills run in parallel", async () => {
    const { db, schema, office } = await loadModules();
    await cleanup(db, schema);
    const original = office.__testHooks.llm;

    let inflightPeak = 0;
    let currentInflight = 0;
    let release;
    const releaseGate = new Promise((res) => { release = res; });

    office.__testHooks.llm = async () => {
        currentInflight += 1;
        if (currentInflight > inflightPeak) inflightPeak = currentInflight;
        // Block until both jobs have entered the LLM call. If the worker
        // serialized them by uid (the old behaviour), the second job would
        // never get here and the test would time out.
        if (currentInflight >= 2) release();
        await Promise.race([
            releaseGate,
            new Promise((r) => setTimeout(r, 5000)),
        ]);
        currentInflight -= 1;
        return "ok\ndraft task: parallel ping\n";
    };

    try {
        office.startOfficeJobsWorker();
        const j1 = await office.enqueueOfficeJob({
            uid: TEST_UID, skillKey: "planner", actionType: "quick_research", argument: "a",
        });
        const j2 = await office.enqueueOfficeJob({
            uid: TEST_UID, skillKey: "brainstorm", actionType: "quick_research", argument: "b",
        });
        const [f1, f2] = await Promise.all([
            waitForJob(db, schema, j1.id, 10000),
            waitForJob(db, schema, j2.id, 10000),
        ]);
        assert.equal(f1.status, "done");
        assert.equal(f2.status, "done");
        assert.ok(inflightPeak >= 2, `expected concurrent execution across skills, peak=${inflightPeak}`);
    } finally {
        office.__testHooks.llm = original;
        office.stopOfficeJobsWorker();
        await cleanup(db, schema);
    }
});

test("two jobs for the same (user, skill) are serialized", async () => {
    const { db, schema, office } = await loadModules();
    await cleanup(db, schema);
    const original = office.__testHooks.llm;

    let currentInflight = 0;
    let peak = 0;
    office.__testHooks.llm = async () => {
        currentInflight += 1;
        if (currentInflight > peak) peak = currentInflight;
        await new Promise((r) => setTimeout(r, 200));
        currentInflight -= 1;
        return "ack\n";
    };
    try {
        office.startOfficeJobsWorker();
        const j1 = await office.enqueueOfficeJob({
            uid: TEST_UID, skillKey: "planner", actionType: "quick_research", argument: "x",
        });
        const j2 = await office.enqueueOfficeJob({
            uid: TEST_UID, skillKey: "planner", actionType: "quick_research", argument: "y",
        });
        await Promise.all([
            waitForJob(db, schema, j1.id, 10000),
            waitForJob(db, schema, j2.id, 10000),
        ]);
        assert.equal(peak, 1, `same (uid,skill) should be serialized, peak=${peak}`);
    } finally {
        office.__testHooks.llm = original;
        office.stopOfficeJobsWorker();
        await cleanup(db, schema);
    }
});

test("getOfficeSkillBreakdown groups counts by skillKey and surfaces last error", async () => {
    const { db, schema, office } = await loadModules();
    await cleanup(db, schema);
    try {
        await db.insert(schema.officeJobs).values([
            { uid: TEST_UID, skillKey: "planner", actionType: "draft_tasks", status: "done", result: "ok", finishedAt: new Date() },
            { uid: TEST_UID, skillKey: "planner", actionType: "draft_tasks", status: "done", result: "ok", finishedAt: new Date() },
            { uid: TEST_UID, skillKey: "planner", actionType: "draft_tasks", status: "queued" },
            { uid: TEST_UID, skillKey: "writer", actionType: "draft_memo", status: "failed", errorMessage: "boom 1", finishedAt: new Date(Date.now() - 60_000) },
            { uid: TEST_UID, skillKey: "writer", actionType: "draft_memo", status: "failed", errorMessage: "boom 2 (latest)", finishedAt: new Date() },
            { uid: TEST_UID, skillKey: "writer", actionType: "draft_memo", status: "running", startedAt: new Date() },
        ]);
        const rows = await office.getOfficeSkillBreakdown({ hours: 24 });
        const planner = rows.find(r => r.skillKey === "planner");
        const writer = rows.find(r => r.skillKey === "writer");
        assert.ok(planner && writer, "both skills should appear");
        assert.equal(planner.done, 2);
        assert.equal(planner.queued, 1);
        assert.equal(planner.failed, 0);
        assert.equal(planner.lastErrorMessage, null);
        assert.equal(writer.failed, 2);
        assert.equal(writer.running, 1);
        assert.equal(writer.lastErrorMessage, "boom 2 (latest)", "should pick most recent failed error");
        assert.ok(writer.lastErrorAt, "should include timestamp of last error");
    } finally {
        await cleanup(db, schema);
    }
});

test("invalid actionType is rejected before insert", async () => {
    const { db, schema, office } = await loadModules();
    await cleanup(db, schema);
    await assert.rejects(
        () => office.enqueueOfficeJob({ uid: TEST_UID, skillKey: "default", actionType: "bogus" }),
        /invalid actionType/,
    );
    const rows = await db.select().from(schema.officeJobs).where(eq(schema.officeJobs.uid, TEST_UID));
    assert.equal(rows.length, 0);
});

// --------------------------------------------------------------------------
// Confidence chips (task #166)
// --------------------------------------------------------------------------

test("confidence baseline falls back to 'medium' for unknown (skill, action)", async () => {
    const office = await import("../server/officeJobs.js");
    const skills = await import("../server/officeSkills.js");
    // Known mapping returns the curated value.
    assert.equal(skills.getBaselineConfidence("writer", "draft_memo"), "high");
    // Unknown skill or unknown action falls back to medium.
    assert.equal(skills.getBaselineConfidence("totally-made-up-skill", "draft_memo"), "medium");
    assert.equal(skills.getBaselineConfidence("writer", "made_up_action"), "medium");

    // gradeJobConfidence with no LLM call (text too short) returns the
    // baseline unchanged. Use a stub that throws if it gets called so we
    // assert no LLM call is fired.
    const original = office.__testHooks.llm;
    let called = 0;
    office.__testHooks.llm = async () => { called += 1; return "OK"; };
    try {
        const out = await office.__testHooks.gradeJobConfidence({
            row: { uid: TEST_UID, skillKey: "writer", actionType: "draft_memo", argument: "" },
            baseline: "high",
            text: "tiny",
        });
        assert.equal(out, "high", "short text → no downgrade, baseline kept");
        assert.equal(called, 0, "tiny text should not trigger the self-rating LLM call");
    } finally {
        office.__testHooks.llm = original;
    }
});

test("confidence self-rating downgrades High→Medium on SHAKY", async () => {
    const office = await import("../server/officeJobs.js");
    const original = office.__testHooks.llm;
    office.__testHooks.llm = async () => "SHAKY";
    try {
        const longBody = "A reasonably long worker output ".repeat(8);
        const out = await office.__testHooks.gradeJobConfidence({
            row: { uid: TEST_UID, skillKey: "writer", actionType: "draft_memo", argument: "" },
            baseline: "high",
            text: longBody,
        });
        assert.equal(out, "medium", "SHAKY verdict downgrades high → medium");
    } finally {
        office.__testHooks.llm = original;
    }
});

test("confidence self-rating skipped when baseline is 'low' (no LLM call)", async () => {
    const office = await import("../server/officeJobs.js");
    const original = office.__testHooks.llm;
    let called = 0;
    office.__testHooks.llm = async () => { called += 1; return "SHAKY"; };
    try {
        const longBody = "A reasonably long worker output ".repeat(8);
        const out = await office.__testHooks.gradeJobConfidence({
            row: { uid: TEST_UID, skillKey: "musk", actionType: "quick_research", argument: "" },
            baseline: "low",
            text: longBody,
        });
        assert.equal(out, "low", "low baseline stays low without an LLM call");
        assert.equal(called, 0, "low baseline must skip the self-rating call");
    } finally {
        office.__testHooks.llm = original;
    }
});

test("confidence self-rating skipped when kill switch is on", async () => {
    const office = await import("../server/officeJobs.js");
    const original = office.__testHooks.llm;
    const prevKill = process.env.OFFICE_CONFIDENCE_DISABLED;
    let called = 0;
    office.__testHooks.llm = async () => { called += 1; return "SHAKY"; };
    process.env.OFFICE_CONFIDENCE_DISABLED = "1";
    try {
        const longBody = "A reasonably long worker output ".repeat(8);
        const out = await office.__testHooks.gradeJobConfidence({
            row: { uid: TEST_UID, skillKey: "writer", actionType: "draft_memo", argument: "" },
            baseline: "high",
            text: longBody,
        });
        assert.equal(out, "high", "kill switch keeps the baseline");
        assert.equal(called, 0, "kill switch must skip the LLM call");
    } finally {
        office.__testHooks.llm = original;
        if (prevKill === undefined) delete process.env.OFFICE_CONFIDENCE_DISABLED;
        else process.env.OFFICE_CONFIDENCE_DISABLED = prevKill;
    }
});

test("minConfidence picks the lowest level (manager aggregate semantics)", async () => {
    const skills = await import("../server/officeSkills.js");
    assert.equal(skills.minConfidence(["high", "medium", "high"]), "medium");
    assert.equal(skills.minConfidence(["high", "low", "medium"]), "low");
    assert.equal(skills.minConfidence(["high", "high"]), "high");
    assert.equal(skills.minConfidence([]), "medium", "empty falls back to medium");
    assert.equal(skills.minConfidence(["high", null, "medium"]), "medium",
        "null normalises to medium and is included in the min");
});

test("reaction inherits parent confidence (no extra LLM call)", async () => {
    const { db, schema, office } = await loadModules();
    await cleanup(db, schema);
    const original = office.__testHooks.llm;
    let called = 0;
    office.__testHooks.llm = async () => { called += 1; return "OK"; };
    try {
        const [parent] = await db.insert(schema.officeJobs).values({
            uid: TEST_UID, skillKey: "writer", actionType: "draft_memo",
            status: "done", result: "ok", confidence: "low", finishedAt: new Date(),
        }).returning();
        const [reaction] = await db.insert(schema.officeJobs).values({
            uid: TEST_UID, skillKey: "munger", actionType: "reaction",
            status: "running", kind: "reaction", parentJobId: parent.id, startedAt: new Date(),
        }).returning();
        const out = await office.__testHooks.inheritReactionConfidence(reaction);
        assert.equal(out, "low", "reaction inherits parent's 'low'");
        assert.equal(called, 0, "inheritance must not call the LLM");

        // Reaction with missing parent → falls back to its own baseline.
        const orphan = { skillKey: "writer", actionType: "reaction", parentJobId: null };
        const fallback = await office.__testHooks.inheritReactionConfidence(orphan);
        assert.ok(["high", "medium", "low"].includes(fallback));
    } finally {
        office.__testHooks.llm = original;
        await cleanup(db, schema);
    }
});

const SPEC_TEXT = `<!-- WRAPUP -->
# Idea to Spec Auto-Save

## What & Why
We want one click that turns a fuzzy idea into a saved, paste-ready spec memo.

## Done looks like
- Brainstorm widens the idea.
- Spec Builder converges into the structured spec format.
- Final spec is auto-saved as a memo tagged \`#spec\` plus a slug.

## Out of scope
- Editing the spec inside the office UI.

## Notes for the implementing agent
- Reuse \`OFFICE_TEMPLATES\` chain runner in \`server/officeJobs.js\`.
- Mirror MuseView's "Save as memo" tag rules.`;

test("ideaToSpec template chains brainstorm → specBuilder and auto-saves a #spec memo", async () => {
    const { db, schema, office } = await loadModules();
    await cleanup(db, schema);

    const original = office.__testHooks.llm;
    let calls = 0;
    office.__testHooks.llm = async () => {
        calls += 1;
        if (calls === 1) {
            // Brainstorm step.
            return "1. Angle one — scope.\n2. Angle two — risks.\n3. Angle three — alternatives.\n" +
                "4. Angle four — done criteria.\n5. Angle five — open questions.";
        }
        // Spec Builder step.
        return SPEC_TEXT;
    };
    try {
        office.startOfficeJobsWorker();
        const parent = await office.startOfficeTemplate({
            uid: TEST_UID,
            templateKey: "ideaToSpec",
            userInput: "auto-save spec memos from the office",
        });
        const final = await waitForJob(db, schema, parent.id, 20000);
        assert.equal(final.status, "done", `got ${final.status}: ${final.errorMessage}`);

        // Two child subtasks: brainstorm/draft_memo + specBuilder/draft_spec.
        const children = await db.select().from(schema.officeJobs)
            .where(eq(schema.officeJobs.parentJobId, parent.id))
            .orderBy(schema.officeJobs.createdAt);
        assert.equal(children.length, 2, "expected 2 chain steps");
        assert.equal(children[0].skillKey, "brainstorm");
        assert.equal(children[0].actionType, "draft_memo");
        assert.equal(children[1].skillKey, "specBuilder");
        assert.equal(children[1].actionType, "draft_spec");
        assert.equal(children[0].status, "done");
        assert.equal(children[1].status, "done");

        // The Spec Builder step must have received the brainstorm result as
        // context (prevResult threading via buildArgument).
        assert.match(children[1].argument, /Angle one — scope/,
            "specBuilder step should be primed with brainstorm output");

        // Auto-save: a memo with the spec title + #spec + slug tags.
        const memos = await db.select().from(schema.memos)
            .where(eq(schema.memos.uid, TEST_UID));
        assert.equal(memos.length, 1, `expected 1 auto-saved memo, got ${memos.length}`);
        assert.equal(memos[0].title, "Idea to Spec Auto-Save");
        assert.match(memos[0].content, /## What & Why/);
        // The invisible WRAPUP marker must be stripped from the saved content.
        assert.doesNotMatch(memos[0].content, /<!--\s*WRAPUP\s*-->/i);

        const tags = await db.select().from(schema.memoTags)
            .where(eq(schema.memoTags.memoId, memos[0].id));
        const tagSet = new Set(tags.map(t => t.tag));
        assert.ok(tagSet.has("spec"), "memo should be tagged #spec");
        assert.ok(tagSet.has("idea-to-spec-auto-save"),
            `memo should also carry the slug tag, got: ${[...tagSet].join(",")}`);

        // Parent result breadcrumb mentions the saved memo.
        assert.match(final.result, /Saved as memo/);
        assert.match(final.result, /Idea to Spec Auto-Save/);
    } finally {
        office.__testHooks.llm = original;
        office.stopOfficeJobsWorker();
        await cleanup(db, schema);
    }
});

test("ideaToSpec is exposed via listOfficeTemplates as a manager-only chain", async () => {
    const { office } = await loadModules();
    const templates = office.listOfficeTemplates();
    const idea = templates.find(t => t.key === "ideaToSpec");
    assert.ok(idea, "ideaToSpec template should be listed");
    assert.equal(idea.steps.length, 2);
    assert.deepEqual(idea.steps.map(s => s.skillKey), ["brainstorm", "specBuilder"]);
    assert.deepEqual(idea.steps.map(s => s.actionType), ["draft_memo", "draft_spec"]);
    assert.equal(office.isValidTemplateKey("ideaToSpec"), true);
});
