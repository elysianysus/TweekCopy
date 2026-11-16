import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

after(() => { setTimeout(() => process.exit(0), 100).unref(); });

const TEST_UID = 999991;

async function loadModules() {
    const { db } = await import("../server/db.js");
    const schema = await import("../server/schema.js");
    const office = await import("../server/officeJobs.js");
    const officeSkills = await import("../server/officeSkills.js");
    return { db, schema, office, officeSkills };
}

async function cleanup(db, schema, uid = TEST_UID) {
    await db.delete(schema.officeJobs).where(eq(schema.officeJobs.uid, uid));
    await db.delete(schema.museMessages).where(eq(schema.museMessages.uid, uid));
    await db.delete(schema.museConversations).where(eq(schema.museConversations.uid, uid));
    await db.delete(schema.workerMemories).where(eq(schema.workerMemories.uid, uid));
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

const SPEC_TEXT = `<!-- WRAPUP -->
# Daily HK news digest

## What & Why
We want one short morning digest of HK news pulled from trusted sources.

## Done looks like
- Cron at 7am pulls top 5 stories.
- Saves a memo with title \`HK Digest YYYY-MM-DD\`.
- Sends a LINE push.

## Out of scope
- Translating to English.
- Custom user filters.

## Notes for the implementing agent
- Reuse \`server/scheduler.js\`.
- Use the existing news source fetcher.
- Suggested first step: add a CRON entry.`;

test("draft_spec office action runs to done and emits the spec wrap-up", async () => {
    const { db, schema, office } = await loadModules();
    await cleanup(db, schema);
    const original = office.__testHooks.llm;
    office.__testHooks.llm = async () => SPEC_TEXT;
    try {
        office.startOfficeJobsWorker();
        const job = await office.enqueueOfficeJob({
            uid: TEST_UID,
            skillKey: "specBuilder",
            actionType: "draft_spec",
            argument: "daily HK news digest",
        });
        const final = await waitForJob(db, schema, job.id);
        assert.equal(final.status, "done", `got ${final.status}: ${final.errorMessage}`);
        assert.ok(final.result.includes("# Daily HK news digest"));
        assert.ok(final.result.includes("## What & Why"));
        assert.ok(final.result.includes("## Done looks like"));
        assert.ok(final.result.includes("## Out of scope"));
        assert.ok(final.result.includes("## Notes for the implementing agent"));
    } finally {
        office.__testHooks.llm = original;
        office.stopOfficeJobsWorker();
        await cleanup(db, schema);
    }
});

test("manager delegate list includes specBuilder + draft_spec is a valid action type", async () => {
    const { office, officeSkills } = await loadModules();
    assert.ok(officeSkills.MANAGER_DELEGATE_SKILLS.includes("specBuilder"),
        "specBuilder should be in MANAGER_DELEGATE_SKILLS");
    assert.ok(!officeSkills.MANAGER_DELEGATE_SKILLS.includes("manager"),
        "manager itself must not be a delegate target");
    assert.ok(officeSkills.BUILT_IN_SKILL_INFO.specBuilder, "BUILT_IN_SKILL_INFO has specBuilder");
    assert.equal(officeSkills.BUILT_IN_SKILL_INFO.specBuilder.label, "Spec Builder");
    assert.equal(office.isValidActionType?.("draft_spec") ?? true, true);
});

test("manager Phase A accepts a delegate to specBuilder/draft_spec", async () => {
    const { db, schema, office } = await loadModules();
    await cleanup(db, schema);
    const original = office.__testHooks.llm;
    let calls = 0;
    office.__testHooks.llm = async () => {
        calls += 1;
        if (calls === 1) {
            // Manager Phase A — return a fenced JSON subtasks block delegating
            // to Spec Builder.
            return "I'll have Spec Builder converge this idea.\n\n```json\n" +
                JSON.stringify({ subtasks: [
                    { skillKey: "specBuilder", actionType: "draft_spec", argument: "the pet feeder idea" },
                ]}) + "\n```";
        }
        // Subtask call — emit a short spec.
        return SPEC_TEXT;
    };
    try {
        office.startOfficeJobsWorker();
        const parent = await office.enqueueOfficeJob({
            uid: TEST_UID, skillKey: "manager", actionType: "delegate",
            argument: "let's design a pet feeder",
        });
        // Wait for parent to reach 'done' (after children finish + aggregation).
        const final = await waitForJob(db, schema, parent.id, 15000);
        assert.equal(final.status, "done", `got ${final.status}: ${final.errorMessage}`);
        // A child subtask row should exist for the specBuilder.
        const children = await db.select().from(schema.officeJobs)
            .where(eq(schema.officeJobs.parentJobId, parent.id));
        assert.ok(children.some(c => c.skillKey === "specBuilder" && c.actionType === "draft_spec"),
            "manager should have spawned a specBuilder/draft_spec subtask");
    } finally {
        office.__testHooks.llm = original;
        office.stopOfficeJobsWorker();
        await cleanup(db, schema);
    }
});
