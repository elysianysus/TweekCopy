import { test, expect } from '@playwright/test';

const DEMO_EMAIL = process.env.E2E_EMAIL || 'demo@tweek.app';
const DEMO_PASSWORD = process.env.E2E_PASSWORD || 'demo1234';

function uniqueName(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function todayInputDate(offsetDays = 0) {
  // Demo user's timezone is Asia/Hong_Kong; compute the date in that zone so
  // seeded tasks land on "today" in the UI's day view regardless of the
  // server's local clock.
  const tz = 'Asia/Hong_Kong';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const base = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

async function apiLogin(page) {
  const r = await page.request.post('/api/login', {
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  if (!r.ok()) throw new Error(`Login failed: ${r.status()} ${await r.text()}`);
}

async function findTaskByName(page, name) {
  const r = await page.request.get('/api/tasks');
  if (!r.ok()) throw new Error(`Tasks fetch failed: ${r.status()}`);
  const list = await r.json();
  return list.find((t) => t.name === name) || null;
}

async function deleteSeriesByName(page, name) {
  const t = await findTaskByName(page, name);
  if (t) {
    const scope = t.repeatSeriesId || t.repeatPattern ? 'series' : 'one';
    await page.request.delete(`/api/tasks/${t.id}?scope=${scope}`);
  }
}

async function purgeTestTasks(page) {
  const r = await page.request.get('/api/tasks');
  if (!r.ok()) return;
  const list = await r.json();
  const targets = list.filter(
    (t) => typeof t.name === 'string' && /^repeat-(add|save|skip|anchor)-/.test(t.name),
  );
  await Promise.all(
    targets.map((t) => {
      const scope = t.repeatSeriesId || t.repeatPattern ? 'series' : 'one';
      return page.request
        .delete(`/api/tasks/${t.id}?scope=${scope}`, { timeout: 8000 })
        .catch(() => {});
    }),
  );
}

test.describe('Recurrence UI — repeat picker, save scope, skip, anchor', () => {
  test.beforeEach(async ({ page }) => {
    // Bypass the client-side access-code gate (it's a sessionStorage flag).
    await page.addInitScript(() => {
      try { sessionStorage.setItem('access_ok', '1'); } catch {}
    });
    await apiLogin(page);
    await purgeTestTasks(page);
    await page.goto('/');
    await expect(page.locator('main').first()).toBeVisible({ timeout: 10000 });
  });

  test('AddTaskInput repeat picker creates a daily recurring task with end date', async ({ page }) => {
    const name = uniqueName('repeat-add');
    const endDate = todayInputDate(14);

    // The collapsed AddTaskInput is a div.add-task placeholder; click it to focus.
    const placeholder = page.locator('div.add-task').first();
    await placeholder.scrollIntoViewIfNeeded();
    await placeholder.click();

    const nameInput = page.locator('div.add-task input[type="text"]').first();
    await expect(nameInput).toBeVisible();
    await nameInput.fill(name);

    // Open repeat picker (rotate icon button next to the input).
    await page.locator('button[title="Set repeat"], button[title^="Repeats:"]').first().click();
    await page.getByRole('button', { name: 'Daily', exact: true }).click();
    await page.locator('div.add-task input[type="date"]').first().fill(endDate);
    await page.getByRole('button', { name: 'Done', exact: true }).click();

    await nameInput.press('Enter');

    await expect.poll(async () => {
      const t = await findTaskByName(page, name);
      return t ? { repeatPattern: t.repeatPattern, repeatEndedAt: t.repeatEndedAt } : null;
    }, { timeout: 10000 }).toMatchObject({ repeatPattern: 'daily', repeatEndedAt: endDate });

    await deleteSeriesByName(page, name);
  });

  test('TaskMenu Save shows 3-way scope prompt for an existing recurring task', async ({ page }) => {
    const name = uniqueName('repeat-save');
    const startDate = todayInputDate(0);

    const create = await page.request.post('/api/tasks', {
      data: {
        name,
        date: startDate,
        order: 0,
        endDate: startDate,
        endTime: '24:00',
        eisenhowerQuadrant: 'q4',
        repeatPattern: 'daily',
      },
    });
    expect(create.ok()).toBeTruthy();

    await page.reload();
    await expect(page.locator('main').first()).toBeVisible();
    await page.getByRole('button', { name: 'Today', exact: true }).click();

    // Task names are visually truncated (e.g. `repeat-save-mopv05...`); match
    // the visible prefix and pick the first visible occurrence (the SPA renders
    // the same task in several hidden panes).
    const namePrefix = name.slice(0, 16);
    const row = page.locator('h5.task-title', { hasText: namePrefix })
      .locator('visible=true').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.scrollIntoViewIfNeeded();
    await row.click();

    // Tweak the TaskMenu's description (scoped by its DOM id, not the page's
    // first textarea, which is the top-level Memo box).
    const description = page.locator('#desc-textarea');
    await expect(description).toBeVisible({ timeout: 5000 });
    await description.fill('e2e tweak ' + uniqueName('d'));

    const saveBtn = page.getByRole('button', { name: 'Save', exact: true }).first();
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();

    await expect(page.getByText('Apply changes to…')).toBeVisible({ timeout: 5000 });
    for (const label of ['Just this one', 'This and future', 'Whole series']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }

    // Capture the PUT /api/tasks/:id request to verify the chosen scope is
    // forwarded to the backend (not just that the modal closes).
    const putPromise = page.waitForRequest(
      (req) =>
        req.method() === 'PUT' &&
        /\/api\/tasks\/\d+(\?|$)/.test(req.url()) &&
        !req.url().includes('/repeat-anchor') &&
        !req.url().includes('/toggle'),
      { timeout: 10000 }
    );
    await page.getByRole('button', { name: 'Just this one', exact: true }).click();
    const putReq = await putPromise;
    const putBody = JSON.parse(putReq.postData() || '{}');
    expect(putBody.applyTo).toBe('one');
    await expect(page.getByText('Apply changes to…')).toHaveCount(0);

    await deleteSeriesByName(page, name);
  });

  test('Skip / un-skip a recurring date from TaskMenu', async ({ page }) => {
    const name = uniqueName('repeat-skip');
    const startDate = todayInputDate(0);
    const skipDate = todayInputDate(3);

    const create = await page.request.post('/api/tasks', {
      data: {
        name,
        date: startDate,
        order: 0,
        endDate: startDate,
        endTime: '24:00',
        eisenhowerQuadrant: 'q4',
        repeatPattern: 'daily',
      },
    });
    expect(create.ok()).toBeTruthy();
    const created = await create.json();
    const taskId = created.id;

    await page.reload();
    await expect(page.locator('main').first()).toBeVisible();
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    const skipRow = page.locator('h5.task-title', { hasText: name.slice(0, 16) })
      .locator('visible=true').first();
    await expect(skipRow).toBeVisible({ timeout: 10000 });
    await skipRow.click();

    // The TaskMenu exposes a labeled "Repeat" button that toggles the picker.
    await page.getByRole('button', { name: 'Repeat', exact: true }).first().click();

    // The skip-date input is the date input adjacent to the "Skip" button.
    const skipBtn = page.getByRole('button', { name: 'Skip', exact: true });
    await expect(skipBtn).toBeVisible();
    const skipInput = skipBtn.locator('xpath=preceding-sibling::input[@type="date"][1]');
    await skipInput.fill(skipDate);
    await expect(skipBtn).toBeEnabled();
    await skipBtn.click();

    // The API may return dates without zero-padded month/day (e.g. `2026-5-6`),
    // so normalize before asserting.
    const normalizeDate = (s) => {
      const [y, m, d] = String(s).split('-');
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };
    await expect.poll(async () => {
      const r = await page.request.get(`/api/tasks/${taskId}/repeat-exceptions`);
      const list = r.ok() ? await r.json() : [];
      return list.map((x) => normalizeDate(x.date));
    }, { timeout: 5000 }).toContain(skipDate);

    await page.getByRole('button', { name: 'Un-skip', exact: true }).first().click();

    await expect.poll(async () => {
      const r = await page.request.get(`/api/tasks/${taskId}/repeat-exceptions`);
      const list = r.ok() ? await r.json() : [];
      return list.map((x) => normalizeDate(x.date));
    }, { timeout: 5000 }).not.toContain(skipDate);

    await deleteSeriesByName(page, name);
  });

  test('Editing the anchor date prompts a confirmation and re-aligns the series', async ({ page }) => {
    const name = uniqueName('repeat-anchor');
    const startDate = todayInputDate(0);
    const newAnchor = todayInputDate(2);

    const create = await page.request.post('/api/tasks', {
      data: {
        name,
        date: startDate,
        order: 0,
        endDate: startDate,
        endTime: '24:00',
        eisenhowerQuadrant: 'q4',
        repeatPattern: 'daily',
      },
    });
    expect(create.ok()).toBeTruthy();
    const created = await create.json();
    const seriesId = created.repeatSeriesId;

    await page.reload();
    await expect(page.locator('main').first()).toBeVisible();
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    const anchorRow = page.locator('h5.task-title', { hasText: name.slice(0, 16) })
      .locator('visible=true').first();
    await expect(anchorRow).toBeVisible({ timeout: 10000 });
    await anchorRow.click();
    await page.getByRole('button', { name: 'Repeat', exact: true }).first().click();

    // The anchor row's date input is the immediate following-sibling of the
    // "Starts" label; the Apply button is the next sibling after that.
    const startsLabel = page.getByText('Starts', { exact: true });
    const anchorInput = startsLabel.locator('xpath=following-sibling::input[@type="date"][1]');
    await anchorInput.fill(newAnchor);

    const applyBtn = startsLabel.locator(
      'xpath=following-sibling::button[normalize-space(.)="Apply"][1]'
    );
    await expect(applyBtn).toBeVisible({ timeout: 5000 });

    // Assert on the network call to the anchor endpoint. The endpoint also
    // re-materializes the series, but that side-effect is timing-dependent
    // and orthogonal to this test (which is about the picker confirming
    // the change and calling the right backend route).
    const normalizeDate = (s) => {
      if (!s) return s;
      const [y, m, d] = String(s).split('-');
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };
    const anchorRespPromise = page.waitForResponse(
      (r) => r.url().includes('/repeat-anchor') && r.request().method() === 'PUT',
      { timeout: 10000 }
    );
    // Capture the dialog synchronously and accept it so click() doesn't
    // deadlock on the unanswered window.confirm.
    let dialogInfo = null;
    page.once('dialog', (d) => {
      dialogInfo = { type: d.type(), message: d.message() };
      d.accept();
    });
    await applyBtn.click();
    expect(dialogInfo, 'expected a confirm dialog to appear').not.toBeNull();
    expect(dialogInfo.type).toBe('confirm');
    expect(dialogInfo.message).toMatch(/start date/i);
    const anchorResp = await anchorRespPromise;
    expect(anchorResp.status()).toBe(200);
    const body = await anchorResp.json();
    expect(body.success).toBe(true);
    expect(normalizeDate(body.repeatAnchorDate)).toBe(newAnchor);

    await deleteSeriesByName(page, name);
  });
});
