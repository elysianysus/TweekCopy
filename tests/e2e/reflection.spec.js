import { test, expect } from '@playwright/test';

const DEMO_EMAIL = process.env.E2E_EMAIL || 'demo@tweek.app';
const DEMO_PASSWORD = process.env.E2E_PASSWORD || 'demo1234';

const REFLECTION_MARKER = '<!-- tweek:reflection -->';

function todayInputDate() {
  const tz = 'Asia/Hong_Kong';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// `formDate` in the SPA emits non-padded month/day (e.g. `2026-5-16`), so the
// memo gets stored under that exact string. Listing endpoints accept either,
// but for matching we normalize both sides.
function normalizeDate(s) {
  if (!s) return s;
  const [y, m, d] = String(s).split('-');
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

async function apiLogin(page) {
  const r = await page.request.post('/api/login', {
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  if (!r.ok()) throw new Error(`Login failed: ${r.status()} ${await r.text()}`);
}

async function listMemosForDate(page, dateStr) {
  // The SPA writes dates as `YYYY-M-D` (non-padded) and the by-date endpoint
  // matches that literal — querying with the padded ISO form returns []. Try
  // the unpadded form first, then the padded one for robustness.
  const tryDates = new Set([dateStr]);
  const norm = normalizeDate(dateStr);
  if (norm) tryDates.add(norm);
  // Build a YYYY-M-D variant by stripping leading zeros from month and day.
  const [y, m, d] = String(dateStr).split('-');
  if (y && m && d) tryDates.add(`${y}-${parseInt(m, 10)}-${parseInt(d, 10)}`);
  for (const dStr of tryDates) {
    const r = await page.request.get(`/api/memos/by-date/${dStr}`);
    if (!r.ok()) continue;
    const list = await r.json();
    if (Array.isArray(list) && list.length > 0) return list;
  }
  return [];
}

async function findReflectionMemoMatching(page, dateStr, nonce) {
  const list = await listMemosForDate(page, dateStr);
  return list.find(
    (m) =>
      typeof m.content === 'string' &&
      m.content.includes(REFLECTION_MARKER) &&
      (!nonce || m.content.includes(nonce)),
  ) || null;
}

async function purgeReflectionMemo(page, dateStr) {
  const list = await listMemosForDate(page, dateStr);
  const targets = list.filter(
    (m) => typeof m.content === 'string' && m.content.includes(REFLECTION_MARKER),
  );
  for (const m of targets) {
    await page.request.delete(`/api/memos/${m.id}`).catch(() => {});
  }
}

test.describe('Daily reflection column', () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    timezoneId: 'Asia/Hong_Kong',
  });

  test('answers persist across reload via the lazy-created memo', async ({ page }) => {
    await page.addInitScript(() => {
      try { sessionStorage.setItem('access_ok', '1'); } catch {}
    });
    await apiLogin(page);
    const dateStr = todayInputDate();
    await purgeReflectionMemo(page, dateStr);

    await page.goto('/');
    await expect(page.locator('main').first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Today', exact: true }).click();

    const nonce = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const prompts = [
      { label: '想改變的事', value: `change-${nonce}` },
      { label: '想停止的事', value: `stop-${nonce}` },
      { label: '想減少的事', value: `reduce-${nonce}` },
      { label: '想開始的事', value: `start-${nonce}` },
      { label: '想增加的事', value: `increase-${nonce}` },
    ];

    // The reflection column renders a div with each prompt's label followed by
    // a textarea. Locate the textarea via that label sibling. The SPA may
    // render mobile and desktop variants in the DOM at the same time; at our
    // pinned 1440px viewport only the desktop variant is visible, so we filter
    // on visibility and pick the first match.
    function textareaFor(label) {
      return page
        .locator(`div:has(> div:text-is("${label}")) > textarea:visible`)
        .first();
    }

    // Wait for the reflection column to be present.
    await expect(textareaFor(prompts[0].label)).toBeVisible({ timeout: 10000 });

    // Fill in each prompt, waiting for the debounced save (POST then PUTs).
    for (const p of prompts) {
      const ta = textareaFor(p.label);
      await ta.scrollIntoViewIfNeeded();
      await ta.fill(p.value);
    }

    // Wait until the server actually has a reflection memo with all answers
    // serialized into its content. This covers both the lazy CREATE on first
    // input and the subsequent debounced PUTs.
    await expect.poll(async () => {
      const memo = await findReflectionMemoMatching(page, dateStr, nonce);
      if (!memo) return null;
      return prompts.every((p) => memo.content.includes(p.value));
    }, { timeout: 15000, intervals: [500, 1000, 1500] }).toBe(true);

    // Reload and confirm each answer reappears in its textarea.
    await page.reload();
    await expect(page.locator('main').first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Today', exact: true }).click();

    for (const p of prompts) {
      const ta = textareaFor(p.label);
      await expect(ta).toBeVisible({ timeout: 10000 });
      await expect(ta).toHaveValue(p.value);
    }

    await purgeReflectionMemo(page, dateStr);
  });
});
