import { test, expect } from '@playwright/test';

const DEMO_EMAIL = process.env.E2E_EMAIL || 'demo@tweek.app';
const DEMO_PASSWORD = process.env.E2E_PASSWORD || 'demo1234';

async function apiLogin(page) {
  const r = await page.request.post('/api/login', {
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  if (!r.ok()) throw new Error(`Login failed: ${r.status()} ${await r.text()}`);
}

// Build a Spec Builder wrap-up SSE body that the MuseView stream parser
// (split-on-`\n`, JSON-parse each `data: ...` line) will accept. The payload
// matches the five-header pattern in src/lib/wrapup.js so isWrapUpMessage()
// fires and "Save as memo" appears.
function buildSpecWrapUpStream() {
  const wrapup =
    '<!-- WRAPUP -->\n' +
    '# Pet feeder MVP\n\n' +
    '## What & Why\n' +
    'A scheduled feeder so the cat eats on time when the owner is away.\n\n' +
    '## Done looks like\n' +
    '- App lets the owner set up to 4 daily feeds.\n' +
    '- Hardware dispenses the configured portion at each feed time.\n\n' +
    '## Out of scope\n' +
    '- Camera / livestream of the cat.\n\n' +
    '## Notes for the implementing agent\n' +
    '- Keep portions in grams, not cups.\n';
  const events = [
    { content: wrapup },
    { done: true, conversationId: 9999 },
  ];
  return events.map((e) => `data: ${JSON.stringify(e)}\n`).join('') + '\n';
}

test.describe('Muse Spec Builder — end-to-end interview → memo → office quick action', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { sessionStorage.setItem('access_ok', '1'); } catch { /* ignore */ }
    });
    await apiLogin(page);
  });

  test('runs the Spec Builder interview, saves the wrap-up as a #spec memo, and offers Draft a spec on the Office sprite', async ({ page }) => {
    // Stub conversations list so MuseView's empty state renders deterministically.
    await page.route('**/api/muse/conversations', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json', body: '[]',
        });
      } else {
        await route.continue();
      }
    });

    // Stub the chat stream with a Spec Builder wrap-up. We don't need to
    // simulate the full multi-turn interview — the contract under test is
    // "wrap-up message renders + Save as memo writes a #spec-tagged memo".
    let chatRequestBody = null;
    await page.route('**/api/muse/chat', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      chatRequestBody = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: buildSpecWrapUpStream(),
      });
    });

    // Capture the memo POST so we can assert title + #spec tag.
    let memoBody = null;
    await page.route('**/api/memos', async (route) => {
      if (route.request().method() === 'POST') {
        memoBody = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ id: 4242, ...memoBody }),
        });
        return;
      }
      await route.continue();
    });

    // Spec memos also fire wiki Ingest as a best-effort follow-up; keep both
    // endpoints quiet so we don't depend on agent state.
    await page.route('**/api/muse/agent/ops', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ killSwitch: true }),
        });
      } else {
        await route.continue();
      }
    });
    await page.route('**/api/muse/agent/run', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // 1) Open MuseView and switch to Spec Builder.
    await page.goto('/?view=muse');
    const specSkillBtn = page.locator('button[data-skill-key="specBuilder"]');
    await expect(specSkillBtn).toBeVisible({ timeout: 15000 });
    await specSkillBtn.click();
    await expect(specSkillBtn).toHaveAttribute('data-active', 'true');

    // 2) "Run the interview" — kick off one user turn; the stub returns the
    // wrap-up message immediately. (The Spec Builder skill in production
    // interviews multi-turn before emitting the wrap-up; here we collapse
    // that to one turn so the test stays deterministic.)
    // Spec Builder has its own placeholder (see getPlaceholder() in
    // MuseView.jsx) hinting at the interview flavor.
    const input = page.getByPlaceholder('Describe the idea you want a spec for...');
    await input.fill('idea: scheduled cat feeder');
    await page.keyboard.press('Enter');

    // The chat POST must carry the active skill so the server selects the
    // Spec Builder system prompt.
    await expect.poll(() => chatRequestBody?.skill, { timeout: 10000 })
      .toBe('specBuilder');

    // 3) Wrap-up bubble appears with the Save as memo button.
    const saveBtn = page.locator('[data-testid^="save-wrapup-memo-"]').first();
    await expect(saveBtn).toBeVisible({ timeout: 10000 });
    await expect(saveBtn).toContainText('Save as memo');

    // 4) Click Save as memo and verify the POST body — title parsed from
    // `# Pet feeder MVP` and tagged with `#spec` per the spec wrap-up branch.
    await saveBtn.click();
    await expect.poll(() => memoBody?.title, { timeout: 10000 }).toBe('Pet feeder MVP');
    expect(memoBody.tags).toContain('spec');
    expect(memoBody.content).toContain('## What & Why');
    expect(memoBody.content).toContain('## Done looks like');
    await expect(saveBtn).toContainText('Saved as memo');

    // 5) Switch to OfficeView and verify the Spec Builder sprite is present.
    // Keep the office jobs poll quiet so nothing flickers in the UI.
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

    // The HUD button overlay is the documented clickable backup for the Pixi
    // sprite (see comment in OfficeView.jsx). One per worker, keyed by label,
    // so its presence proves the Spec Builder sprite was placed.
    const specSprite = page.getByRole('button', { name: 'Open dialog with Spec Builder' });
    await expect(specSprite).toBeVisible({ timeout: 10000 });

    // 6) Click the sprite → Quick action → confirm "Draft a spec" is offered.
    await specSprite.click();
    const quickActionBtn = page.getByRole('button', { name: 'Quick action', exact: true });
    await expect(quickActionBtn).toBeVisible({ timeout: 5000 });
    await quickActionBtn.click();
    await expect(page.getByText('Draft a spec', { exact: true })).toBeVisible({ timeout: 5000 });

    // Sanity: selecting it and pressing Send dispatches an office job with
    // skillKey=specBuilder + actionType=draft_spec. We intercept the POST and
    // fulfil locally so this does not enqueue real work.
    let officePost = null;
    await page.route('**/api/office/jobs', async (route) => {
      if (route.request().method() === 'POST') {
        officePost = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ id: 1, status: 'queued', ...officePost }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByText('Draft a spec', { exact: true }).click();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => officePost?.actionType, { timeout: 5000 }).toBe('draft_spec');
    expect(officePost.skillKey).toBe('specBuilder');
  });
});
