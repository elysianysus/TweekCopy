import { test, expect } from '@playwright/test';

// REQUIRES the server to be started with `LAST30DAYS_ALLOW_DRY_RUN_HEADER=1`
// so the route handler honors a per-request `dryRun: true` body field. With
// that env var set, this spec opts each run into the dry-run fixture without
// affecting any other dev / production traffic. The test still drives the
// *real* /api/last30days/runs endpoints (POST, GET list, GET by id with
// ?include=html, save-as-memo, DELETE) — only the Python engine is stubbed.

const DEMO_EMAIL = process.env.E2E_EMAIL || 'demo@tweek.app';
const DEMO_PASSWORD = process.env.E2E_PASSWORD || 'demo1234';

async function apiLogin(page) {
    const r = await page.request.post('/api/login', {
        data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
    });
    if (!r.ok()) throw new Error(`Login failed: ${r.status()} ${await r.text()}`);
}

async function purgeRuns(page, topicMatch) {
    const r = await page.request.get('/api/last30days/runs?limit=100');
    if (!r.ok()) return;
    const list = await r.json();
    await Promise.all(
        list
            .filter((row) => topicMatch.test(row.topic || ''))
            .map((row) => page.request.delete(`/api/last30days/runs/${row.id}`).catch(() => {})),
    );
}

test.describe('Last 30 Days research panel — submit, poll, brief actions', () => {
    test.beforeEach(async ({ page, context }) => {
        // Bypass the client-side access-code gate (sessionStorage flag).
        await page.addInitScript(() => {
            try { sessionStorage.setItem('access_ok', '1'); } catch { /* ignore */ }
        });
        await apiLogin(page);

        // Opt every POST /api/last30days/runs from this browser context into
        // the per-request dry-run path. The route handler only honors the
        // header when LAST30DAYS_ALLOW_DRY_RUN_HEADER=1 is set on the server,
        // so a stray header in normal dev traffic is ignored.
        await context.setExtraHTTPHeaders({ 'x-last30days-dry-run': '1' });

        // Fail fast (and loudly) if the server isn't honoring the per-request
        // dry-run opt-in. Without it, this test would either time out (the
        // real engine is slow) or — worse — silently hit third-party APIs.
        // We submit a tiny probe run with dryRun:true and assert the worker
        // produced the fixture brief (the wrapper tags every dry-run body
        // with the literal string `LAST30DAYS_DRY_RUN`).
        const probeTopic = `e2e-last30days-probe-${Date.now().toString(36)}`;
        const probe = await page.request.post('/api/last30days/runs', {
            data: { topic: probeTopic, sources: ['reddit'], dryRun: true },
        });
        if (!probe.ok()) throw new Error(`Dry-run probe POST failed: ${probe.status()}`);
        const probeRow = await probe.json();
        let probeStatus = probeRow.status;
        const deadline = Date.now() + 15000;
        while (probeStatus !== 'succeeded' && probeStatus !== 'failed' && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 500));
            const r = await page.request.get(`/api/last30days/runs/${probeRow.id}?include=html`);
            if (!r.ok()) break;
            const data = await r.json();
            probeStatus = data.status;
            if (probeStatus === 'succeeded') {
                if (!String(data.html || '').includes('LAST30DAYS_DRY_RUN')) {
                    throw new Error(
                        'Dry-run probe succeeded but the brief is not the fixture — ' +
                        'start the server with LAST30DAYS_ALLOW_DRY_RUN_HEADER=1 before running this spec.'
                    );
                }
            }
            if (probeStatus === 'failed') {
                throw new Error(
                    `Dry-run probe failed (${data.errorMessage || 'unknown'}). ` +
                    'Start the server with LAST30DAYS_ALLOW_DRY_RUN_HEADER=1 and ensure the wrapper is installed.'
                );
            }
        }
        if (probeStatus !== 'succeeded') {
            throw new Error(
                `Dry-run probe did not finish in 15s (last status=${probeStatus}). ` +
                'Start the server with LAST30DAYS_ALLOW_DRY_RUN_HEADER=1 to keep this test fast and deterministic.'
            );
        }
        await page.request.delete(`/api/last30days/runs/${probeRow.id}`).catch(() => {});

        await purgeRuns(page, /^e2e-last30days-/);
    });

    test.afterEach(async ({ page }) => {
        await purgeRuns(page, /^e2e-last30days-/);
    });

    test('submits a topic, polls until succeeded, and saves the brief as a memo', async ({ page }) => {
        const topic = `e2e-last30days-${Date.now().toString(36)}`;

        await page.goto('/?view=last30days');

        // Header confirms we're on the right view.
        await expect(page.getByRole('heading', { name: 'Last 30 Days' })).toBeVisible({ timeout: 15000 });

        // Type the topic into the textarea.
        const textarea = page.locator('textarea').first();
        await textarea.fill(topic);

        // Sanity-check default source selection: Reddit / HN / GitHub are
        // pre-toggled and don't need any API key, so they work with dry-run.
        await expect(page.getByRole('button', { name: /^Reddit/ })).toBeVisible();

        // Dispatch — wait for the POST to complete so we know the server has
        // accepted the run before we start watching for the status pill.
        const [postResp] = await Promise.all([
            page.waitForResponse(
                (r) => r.url().endsWith('/api/last30days/runs') && r.request().method() === 'POST',
                { timeout: 10000 },
            ),
            page.getByRole('button', { name: /Run research/ }).click(),
        ]);
        expect(postResp.ok()).toBeTruthy();
        const created = await postResp.json();
        expect(typeof created.id).toBe('number');

        // The active-run card mounts immediately with a pending status pill
        // (Queued / Running…). The polling loop (3s) flips it to "Done" once
        // the dry-run wrapper finishes (effectively instant).
        await expect(page.getByText('Done', { exact: true })).toBeVisible({ timeout: 30000 });

        // The fixture brief mentions the topic in its body, so wait for the
        // sanitized HTML to render before driving the action buttons. The
        // outer panel wrapper uses `.last30days-panel`; the engine-rendered
        // HTML inside is the only element with `.last30days-brief`, so the
        // class is unique on the page.
        const briefBody = page.locator('.last30days-brief');
        await expect(briefBody).toBeVisible({ timeout: 10000 });
        await expect(briefBody).toContainText(topic, { timeout: 10000 });

        // Save-as-memo: click the button, watch the POST resolve, and assert
        // both the success affordance ("Open memo" link) and the actual
        // server-side memo creation by re-fetching the memo by id.
        const [saveResp] = await Promise.all([
            page.waitForResponse(
                (r) => /\/api\/last30days\/runs\/\d+\/save-as-memo$/.test(r.url())
                    && r.request().method() === 'POST',
                { timeout: 15000 },
            ),
            page.getByRole('button', { name: /Save as memo/ }).click(),
        ]);
        expect(saveResp.ok()).toBeTruthy();
        const saveBody = await saveResp.json();
        expect(typeof saveBody.memoId).toBe('number');

        // The "Open memo" link appears once the save resolves.
        const openMemoLink = page.getByRole('link', { name: 'Open memo' });
        await expect(openMemoLink).toBeVisible({ timeout: 5000 });
        await expect(openMemoLink).toHaveAttribute('href', `?view=memo&memoId=${saveBody.memoId}`);

        // Verify the memo really exists on the backend so the test would fail
        // loudly if the route silently regressed. There's no GET /api/memos/:id
        // route, so fetch the list and find the one we just created.
        const memosResp = await page.request.get('/api/memos');
        expect(memosResp.ok()).toBeTruthy();
        const memos = await memosResp.json();
        const memo = (Array.isArray(memos) ? memos : []).find((m) => m.id === saveBody.memoId);
        expect(memo, `expected memo ${saveBody.memoId} in /api/memos response`).toBeTruthy();
        expect(memo.noteType).toBe('last30days');
        expect((memo.title || '').includes(topic) || (memo.content || '').includes(topic)).toBeTruthy();

        // Cleanup the memo so the demo account isn't littered with run-as-memo
        // rows after each e2e pass.
        await page.request.delete(`/api/memos/${saveBody.memoId}`).catch(() => {});

        // The run also shows up in the "Past runs" history collapsible.
        await expect(
            page.locator('div.cursor-pointer').filter({ hasText: topic }).first(),
        ).toBeVisible({ timeout: 5000 });
    });
});
