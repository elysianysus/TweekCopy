import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

after(() => { setTimeout(() => process.exit(0), 100).unref(); });

const TEST_UID = 999992;

async function loadModules() {
    const { db } = await import("../server/db.js");
    const schema = await import("../server/schema.js");
    const shared = await import("../server/museShared.js");
    return { db, schema, shared };
}

async function ensureUser(db, schema) {
    await db.delete(schema.users).where(eq(schema.users.id, TEST_UID));
    await db.insert(schema.users).values({
        id: TEST_UID,
        email: `spec-builder-test-${TEST_UID}@example.com`,
        password: "x",
        name: "Spec Builder Test",
    });
}

async function cleanup(db, schema) {
    await db.delete(schema.users).where(eq(schema.users.id, TEST_UID));
}

test("sanitizeSpecBuilderQuestions accepts a clean list, trims, drops empties", async () => {
    const { shared } = await loadModules();
    const r = shared.sanitizeSpecBuilderQuestions([
        "  What's the rollback plan?  ",
        "",
        "Who is the primary user?",
    ]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, ["What's the rollback plan?", "Who is the primary user?"]);
});

test("sanitizeSpecBuilderQuestions returns null value when input is null/empty (=> defaults)", async () => {
    const { shared } = await loadModules();
    assert.deepEqual(shared.sanitizeSpecBuilderQuestions(null), { ok: true, value: null });
    assert.deepEqual(shared.sanitizeSpecBuilderQuestions(undefined), { ok: true, value: null });
    assert.deepEqual(shared.sanitizeSpecBuilderQuestions([]), { ok: true, value: null });
    assert.deepEqual(shared.sanitizeSpecBuilderQuestions(["", "  "]), { ok: true, value: null });
});

test("sanitizeSpecBuilderQuestions rejects non-array, non-string, too-long, too-many", async () => {
    const { shared } = await loadModules();
    assert.equal(shared.sanitizeSpecBuilderQuestions("oops").ok, false);
    assert.equal(shared.sanitizeSpecBuilderQuestions([1, 2]).ok, false);
    assert.equal(shared.sanitizeSpecBuilderQuestions(["x".repeat(241)]).ok, false);
    assert.equal(shared.sanitizeSpecBuilderQuestions(Array(21).fill("q")).ok, false);
});

test("loadSpecBuilderQuestions falls back to defaults when no override is set", async () => {
    const { db, schema, shared } = await loadModules();
    await ensureUser(db, schema);
    try {
        const qs = await shared.loadSpecBuilderQuestions(TEST_UID);
        assert.deepEqual(qs, shared.DEFAULT_SPEC_BUILDER_QUESTIONS);
    } finally {
        await cleanup(db, schema);
    }
});

test("loadSpecBuilderQuestions returns the user's custom list when persisted", async () => {
    const { db, schema, shared } = await loadModules();
    await ensureUser(db, schema);
    try {
        const custom = ["What's the rollback plan?", "Who owns the on-call rotation?"];
        await db.update(schema.users)
            .set({ specBuilderQuestions: JSON.stringify(custom) })
            .where(eq(schema.users.id, TEST_UID));
        const qs = await shared.loadSpecBuilderQuestions(TEST_UID);
        assert.deepEqual(qs, custom);
    } finally {
        await cleanup(db, schema);
    }
});

test("loadSpecBuilderQuestions falls back to defaults when stored JSON is malformed", async () => {
    const { db, schema, shared } = await loadModules();
    await ensureUser(db, schema);
    try {
        await db.update(schema.users)
            .set({ specBuilderQuestions: "{not json" })
            .where(eq(schema.users.id, TEST_UID));
        const qs = await shared.loadSpecBuilderQuestions(TEST_UID);
        assert.deepEqual(qs, shared.DEFAULT_SPEC_BUILDER_QUESTIONS);
    } finally {
        await cleanup(db, schema);
    }
});

test("buildMuseSkillPrompt injects the user's custom Spec Builder questions", async () => {
    const { db, schema, shared } = await loadModules();
    await ensureUser(db, schema);
    try {
        const custom = ["What's the rollback plan?", "Who owns the on-call rotation?"];
        await db.update(schema.users)
            .set({ specBuilderQuestions: JSON.stringify(custom) })
            .where(eq(schema.users.id, TEST_UID));
        const { systemContent } = await shared.buildMuseSkillPrompt({
            uid: TEST_UID,
            skill: "specBuilder",
            today: "2026-05-13",
            taskContext: "",
            allTaskContext: "",
            userTasks: [],
        });
        assert.ok(systemContent.includes("What's the rollback plan?"), "should include first custom question");
        assert.ok(systemContent.includes("Who owns the on-call rotation?"), "should include second custom question");
        assert.ok(systemContent.includes(`with ${custom.length} targeted questions`), "should reflect custom count");
        // Default question text must NOT appear.
        assert.ok(!systemContent.includes("Target outcome (what does success look like one sentence?)"));
    } finally {
        await cleanup(db, schema);
    }
});

test("buildMuseSkillPrompt uses defaults when user has no override (reset behavior)", async () => {
    const { db, schema, shared } = await loadModules();
    await ensureUser(db, schema);
    try {
        // simulate "reset" by clearing the column.
        await db.update(schema.users)
            .set({ specBuilderQuestions: null })
            .where(eq(schema.users.id, TEST_UID));
        const { systemContent } = await shared.buildMuseSkillPrompt({
            uid: TEST_UID,
            skill: "specBuilder",
            today: "2026-05-13",
            taskContext: "",
            allTaskContext: "",
            userTasks: [],
        });
        for (const q of shared.DEFAULT_SPEC_BUILDER_QUESTIONS) {
            assert.ok(systemContent.includes(q), `default question missing: ${q}`);
        }
        assert.ok(systemContent.includes(`with ${shared.DEFAULT_SPEC_BUILDER_QUESTIONS.length} targeted questions`));
    } finally {
        await cleanup(db, schema);
    }
});
