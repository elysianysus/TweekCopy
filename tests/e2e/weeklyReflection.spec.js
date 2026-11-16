import { test, expect } from '@playwright/test';
import { withReadOnlyReflectionFixtures } from '../helpers/readOnlyReflectionFixtures.js';

const DEMO_EMAIL = process.env.E2E_EMAIL || 'demo@tweek.app';
const DEMO_PASSWORD = process.env.E2E_PASSWORD || 'demo1234';

const REFLECTION_MARKER = '<!-- tweek:reflection -->';
const REFLECTION_END_MARKER = '<!-- /tweek:reflection -->';
const REFLECTION_TITLE = '三省吾身';

function todayInHK() {
    const tz = 'Asia/Hong_Kong';
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date()).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
}

// Mirror the SPA's `formDate` (unpadded YYYY-M-D) so fixture memos match what
// the by-date lookup expects.
function formDate(d) {
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

// Mirror TaskListContainer's week math: dayOfWeek = (curDate.getDay() - 1) % 7
// then dates run from -dayOfWeek to -dayOfWeek + 7. Use UTC getters since our
// HK-anchored "today" is constructed at UTC midnight.
function weekDatesFor(today) {
    const dayOfWeek = (today.getUTCDay() - 1) % 7; // can be negative for Sunday
    const out = [];
    for (let i = -dayOfWeek; i < -dayOfWeek + 7; ++i) {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() + i);
        out.push(d);
    }
    return out;
}

function buildReflectionMemo(answers, nonce) {
    const order = [
        ['change', '想改變的事'],
        ['stop', '想停止的事'],
        ['reduce', '想減少的事'],
        ['start', '想開始的事'],
        ['increase', '想增加的事'],
    ];
    const lines = [REFLECTION_MARKER, `# ${REFLECTION_TITLE}`, ''];
    for (const [id, heading] of order) {
        const v = (answers[id] || '').trim();
        if (!v) continue;
        lines.push(`## ${heading}`);
        lines.push(v);
        lines.push('');
    }
    lines.push(REFLECTION_END_MARKER);
    lines.push(`<!-- weekly-rollup-e2e:${nonce} -->`);
    return lines.join('\n');
}

async function apiLogin(page) {
    const r = await page.request.post('/api/login', {
        data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
    });
    if (!r.ok()) throw new Error(`Login failed: ${r.status()} ${await r.text()}`);
}

test.describe('Weekly Reflection rollup panel', () => {
    test.use({
        viewport: { width: 1440, height: 900 },
        timezoneId: 'Asia/Hong_Kong',
    });

    test('shows multi-day entries grouped by prompt and navigates to the day on click', async ({ page }) => {
        await page.addInitScript(() => {
            try { sessionStorage.setItem('access_ok', '1'); } catch {}
        });
        await apiLogin(page);

        const today = todayInHK();
        const weekDates = weekDatesFor(today);
        // Pick 3 distinct days inside the current week so the panel will load them.
        const pickedIndices = [0, Math.min(2, weekDates.length - 1), Math.min(4, weekDates.length - 1)];
        const uniqIdx = Array.from(new Set(pickedIndices)).slice(0, 3);
        const picked = uniqIdx.map((i) => weekDates[i]);
        const pickedStrs = picked.map(formDate);

        const nonce = `wkr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

        // Fixture answers — different days fill different prompts so we can prove
        // entries are routed to the right prompt column.
        const seeds = [
            { change: `[${nonce}] ship roadmap v1\n- finalize milestones`, start: `[${nonce}] daily 7am walks` },
            { stop: `[${nonce}] doomscrolling at night`, reduce: `[${nonce}] meeting time` },
            { increase: `[${nonce}] focused deep work\n- two 90-min blocks\n- silence notifications` },
        ];

        const memos = pickedStrs.map((date, i) => ({
            id: 900001 + i,
            title: `Reflection ${date}`,
            content: buildReflectionMemo(seeds[i], nonce),
            date,
            color: 'white',
        }));
        await withReadOnlyReflectionFixtures(page, memos, async () => {
            await page.goto('/');
            await expect(page.locator('main').first()).toBeVisible({ timeout: 10000 });
            // The Weekly Reflection rollup only renders inside the Week view.
            // Click Week explicitly — the "Today" button puts us in a day-style
            // dashboard that doesn't include the rollup.
            await page.getByRole('button', { name: 'Week', exact: true }).click();

            // Expand the Weekly Reflection panel.
            const toggle = page.getByRole('button', { name: /Weekly Reflection/ });
            await expect(toggle).toBeVisible({ timeout: 10000 });
            await toggle.click();

            // The panel renders one card per prompt; each card holds the entries
            // for days that answered that prompt. We assert per-prompt content.
            const findCard = (label) => page
                .locator(`div:has(> div:text-is("${label}"))`)
                .first();

            // Wait for content to load (cards are present even when empty, but
            // the fixture text should appear after the fetch resolves).
            await expect(page.getByText(`[${nonce}] ship roadmap v1`)).toBeVisible({ timeout: 10000 });

            // Per-prompt routing
            const changeCard = findCard('想改變的事');
            await expect(changeCard).toContainText(`[${nonce}] ship roadmap v1`);
            await expect(changeCard).toContainText('finalize milestones');
            // The "stop" prompt's text must NOT appear in the "change" card.
            await expect(changeCard).not.toContainText('doomscrolling');

            const stopCard = findCard('想停止的事');
            await expect(stopCard).toContainText('doomscrolling at night');

            const startCard = findCard('想開始的事');
            await expect(startCard).toContainText('daily 7am walks');

            const increaseCard = findCard('想增加的事');
            await expect(increaseCard).toContainText('focused deep work');
            // Bullets split into separate <li> entries:
            await expect(increaseCard).toContainText('two 90-min blocks');
            await expect(increaseCard).toContainText('silence notifications');

            // Click the entry in the "change" card → URL should navigate to the
            // day view for the fixture date.
            const firstEntry = changeCard
                .getByRole('button', { name: /ship roadmap v1/ })
                .first();
            await firstEntry.click();

            await expect.poll(() => {
                const url = new URL(page.url());
                return {
                    view: url.searchParams.get('view'),
                    viewDate: url.searchParams.get('viewDate'),
                    weekShift: url.searchParams.get('weekShift'),
                };
            }, { timeout: 5000 }).toEqual({
                view: 'day',
                viewDate: pickedStrs[0],
                weekShift: null,
            });
        });
    });
});
