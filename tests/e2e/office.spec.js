import { test, expect } from '@playwright/test';

const DEMO_EMAIL = process.env.E2E_EMAIL || 'demo@tweek.app';
const DEMO_PASSWORD = process.env.E2E_PASSWORD || 'demo1234';

// Player spawn from OfficeView.jsx: (floor(ROOM_COLS/2), ROOM_ROWS-2).
// Keep these in sync with src/lib/officeRoom.js (ROOM_COLS=18, ROOM_ROWS=12).
const PLAYER_START = { x: 9, y: 10 };
const CELL = 36;

async function apiLogin(page) {
  const r = await page.request.post('/api/login', {
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  if (!r.ok()) throw new Error(`Login failed: ${r.status()} ${await r.text()}`);
}

async function tap(page, key, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    // Small delay so React state updates settle and `isBlocked`
    // re-evaluates before the next keypress.
    await page.waitForTimeout(60);
  }
}

test.describe('Muse Office — end-to-end walk-up + quick action', () => {
  test.beforeEach(async ({ page }) => {
    // Bypass the client-side access-code gate (sessionStorage flag).
    await page.addInitScript(() => {
      try { sessionStorage.setItem('access_ok', '1'); } catch { /* ignore */ }
    });
    await apiLogin(page);
  });

  test('player walks to a worker, queues Quick research, and the bubble flips queued → done', async ({ page }) => {
    // Stub the office job endpoints so the test is deterministic and never
    // hits the real LLM / DB queue. We still drive the real UI: keyboard
    // input, modal flow, and the polling/bubble pipeline.
    let recordedJob = null;
    let pollCount = 0;
    await page.route('**/api/office/jobs**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        recordedJob = JSON.parse(req.postData() || '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 1, status: 'queued',
            skillKey: recordedJob.skillKey,
            actionType: recordedJob.actionType,
            argument: recordedJob.argument || '',
          }),
        });
        return;
      }
      // GET /api/office/jobs[?limit=...] — before dispatch return [], then
      // return a single job that goes queued → done across polls.
      let list = [];
      if (recordedJob) {
        const status = pollCount < 1 ? 'queued' : 'done';
        pollCount += 1;
        list = [{
          id: 1,
          uid: 'demo',
          skillKey: recordedJob.skillKey,
          actionType: recordedJob.actionType,
          argument: recordedJob.argument || '',
          status,
          result: status === 'done' ? 'ok' : null,
          errorMessage: null,
          conversationId: null,
          assistantMessageId: null,
          createdAt: new Date().toISOString(),
          startedAt: null,
          finishedAt: status === 'done' ? new Date().toISOString() : null,
        }];
      }
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(list),
      });
    });

    await page.goto('/?view=office');
    const grid = page.locator('[aria-label="Muse Office grid"]');
    await expect(grid).toBeVisible({ timeout: 15000 });

    // Read every desk's grid coords from its inline style. Desks are styled
    // as `left: deskX*CELL + 2; top: deskY*CELL + 4`.
    await expect(grid.locator('> div[title]').first()).toBeVisible({ timeout: 10000 });
    const desks = await grid.locator('> div[title]').evaluateAll((els, cell) => els.map((el) => ({
      deskX: Math.round((parseInt(el.style.left, 10) - 2) / cell),
      deskY: Math.round((parseInt(el.style.top, 10) - 4) / cell),
      label: el.getAttribute('title'),
    })), CELL);
    expect(desks.length).toBeGreaterThan(0);

    // Pick a row-2 desk (deskY ≈ ROOM_ROWS-4) so the path from spawn (9, 10)
    // is unobstructed: walk up one row to y=9 (which only ever holds interact
    // tiles, never desks) and then sideways to the interact column. Fall back
    // to the bottom-most desks available if there's no row-2 row.
    const maxDeskY = Math.max(...desks.map((d) => d.deskY));
    const candidates = desks.filter((d) => d.deskY === maxDeskY);
    candidates.sort((a, b) => Math.abs(a.deskX - PLAYER_START.x) - Math.abs(b.deskX - PLAYER_START.x));
    const target = candidates[0];

    const interactX = target.deskX;
    const interactY = target.deskY + 1;

    // Make sure the window has keyboard focus before pressing keys.
    await grid.click({ position: { x: 4, y: 4 } });

    // Move vertically first (along the empty interact-tile row), then sideways.
    // Mix WASD with arrow keys so both keyboard schemes get exercised.
    const dyFirst = interactY - PLAYER_START.y;
    if (dyFirst !== 0) await tap(page, dyFirst > 0 ? 's' : 'w', Math.abs(dyFirst));
    const dx = interactX - PLAYER_START.x;
    if (dx !== 0) await tap(page, dx > 0 ? 'd' : 'a', Math.abs(dx));

    // The "press E" prompt confirms the player is adjacent to the worker.
    await expect(
      page.getByText(`E / tap to interact with ${target.label}`)
    ).toBeVisible({ timeout: 5000 });

    // Press E to open the interaction modal.
    await page.keyboard.press('e');
    const quickActionBtn = page.getByRole('button', { name: 'Quick action', exact: true });
    await expect(quickActionBtn).toBeVisible({ timeout: 5000 });

    // Verify the modal header reflects the worker we walked up to.
    const modal = quickActionBtn.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
    await expect(modal.getByText(target.label, { exact: true })).toBeVisible();

    // Quick action → Quick research → Send.
    await quickActionBtn.click();
    await page.getByRole('radio', { name: 'Quick research' }).check();

    const postPromise = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith('/api/office/jobs'),
      { timeout: 10000 }
    );
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const postReq = await postPromise;
    const postBody = JSON.parse(postReq.postData() || '{}');
    expect(postBody.actionType).toBe('quick_research');
    expect(typeof postBody.skillKey).toBe('string');
    expect(postBody.skillKey.length).toBeGreaterThan(0);

    // Modal closes after dispatch.
    await expect(quickActionBtn).toBeHidden({ timeout: 5000 });

    // First poll after dispatch -> "queued…" bubble appears.
    await expect(page.getByText('queued…')).toBeVisible({ timeout: 5000 });

    // Subsequent polls (every 1.5s) -> bubble flips to "done".
    await expect(page.getByText('done', { exact: true })).toBeVisible({ timeout: 8000 });
  });

  test('Chat button hands off to MuseView with ?view=muse&skill=<workerKey>', async ({ page }) => {
    // Keep the office jobs poll quiet so the test isn't racing real DB rows.
    await page.route('**/api/office/jobs**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json', body: '[]',
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/?view=office');
    const grid = page.locator('[aria-label="Muse Office grid"]');
    await expect(grid).toBeVisible({ timeout: 15000 });

    await expect(grid.locator('> div[title]').first()).toBeVisible({ timeout: 10000 });
    // Read each desk's grid coords *and* its skill key (data-skill-key on
    // the desk div). The key is what OfficeView writes into ?skill=, and
    // the same key is what MuseView keys its SKILLS grid buttons by — so
    // the test can verify the round-trip without depending on labels
    // (Office labels and Muse labels are intentionally not the same for
    // several skills, e.g. Office "Feynman" / Muse "費曼").
    const desks = await grid.locator('> div[title][data-skill-key]').evaluateAll((els, cell) => els.map((el) => ({
      deskX: Math.round((parseInt(el.style.left, 10) - 2) / cell),
      deskY: Math.round((parseInt(el.style.top, 10) - 4) / cell),
      label: el.getAttribute('title'),
      skillKey: el.getAttribute('data-skill-key'),
    })), CELL);
    expect(desks.length).toBeGreaterThan(0);
    // Restrict to built-in skills so the assertion against MuseView's
    // empty-state SKILLS grid (which only renders built-ins) stays stable
    // even if the demo user ever gains custom skills (which use
    // `custom_*` keys and render in a separate Custom Skills section).
    const builtInDesks = desks.filter((d) => d.skillKey && !d.skillKey.startsWith('custom_'));
    expect(builtInDesks.length).toBeGreaterThan(0);
    const maxDeskY = Math.max(...builtInDesks.map((d) => d.deskY));
    const candidates = builtInDesks.filter((d) => d.deskY === maxDeskY);
    candidates.sort((a, b) => Math.abs(a.deskX - PLAYER_START.x) - Math.abs(b.deskX - PLAYER_START.x));
    const target = candidates[0];
    expect(target.skillKey).toBeTruthy();

    await grid.click({ position: { x: 4, y: 4 } });
    const dyFirst = (target.deskY + 1) - PLAYER_START.y;
    if (dyFirst !== 0) await tap(page, dyFirst > 0 ? 'ArrowDown' : 'ArrowUp', Math.abs(dyFirst));
    const dx = target.deskX - PLAYER_START.x;
    if (dx !== 0) await tap(page, dx > 0 ? 'ArrowRight' : 'ArrowLeft', Math.abs(dx));

    await expect(
      page.getByText(`E / tap to interact with ${target.label}`)
    ).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('e');

    const chatBtn = page.getByRole('button', { name: 'Chat', exact: true });
    await expect(chatBtn).toBeVisible({ timeout: 5000 });
    await chatBtn.click();

    // The Chat button must rewrite the URL to ?view=muse&skill=<workerKey>
    // exactly — that's the OfficeView → MuseView routing contract.
    await expect.poll(() => {
      const u = new URL(page.url());
      return {
        view: u.searchParams.get('view'),
        skill: u.searchParams.get('skill'),
      };
    }, { timeout: 5000 }).toEqual({ view: 'muse', skill: target.skillKey });

    await expect(grid).toBeHidden({ timeout: 5000 });

    // MuseView should mount with that skill preselected. The empty-state
    // SKILLS grid renders one `<button data-skill-key=...>` per built-in
    // skill and stamps `data-active="true"` on the one matching activeSkill.
    // For non-default skills MuseView also renders an active-skill chip
    // alongside the model picker, but the empty-state grid is the cheaper
    // assertion and works for the default skill too.
    const activeSkillBtn = page.locator(`button[data-skill-key="${target.skillKey}"]`);
    await expect(activeSkillBtn).toBeVisible({ timeout: 5000 });
    await expect(activeSkillBtn).toHaveAttribute('data-active', 'true');
  });
});
