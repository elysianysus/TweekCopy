import { test, expect } from '@playwright/test';

// Browser fixtures seed a week without deleting or modifying any user's memos.
// The HTTP integration suite separately exercises the real summary cache service.
test.use({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Hong_Kong' });

for (const scenario of [
    { name: 'renders the returned Theme above its tag cloud' },
    { name: 'keeps entries and tags readable after a model error', response: { summary: '', cached: false, error: 'Mock model unavailable' } },
    { name: 'keeps entries and tags readable after an empty model response', response: { summary: '', cached: false, skipped: 'empty_response' } },
    { name: 'keeps entries and tags readable after an HTTP failure', status: 500, response: { error: 'Mock summary unavailable' } },
]) {
test(`weekly reflection ${scenario.name}`, async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('access_ok', '1'));
    const login = await page.request.post('/api/login', {
        data: {
            email: process.env.E2E_EMAIL || 'demo@tweek.app',
            password: process.env.E2E_PASSWORD || 'demo1234',
        },
    });
    expect(login.ok(), 'test account login must succeed').toBeTruthy();
    const theme = 'Focused reading and writing brought steady progress this week.';
    const summaryRequests = [];
    const memoDates = new Set();
    await page.route('**/api/memos/by-date/*', async route => {
        const ds = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
        memoDates.add(ds);
        await route.fulfill({ json: [{
            id: 900001, date: ds, title: 'Seeded reflection',
            content: '<!-- tweek:reflection -->\n# 三省吾身\n\n## 想改變的事\n- focused reading\n- focused writing\n- focused learning\n\n<!-- /tweek:reflection -->',
        }] });
    });
    await page.route('**/api/reflection-summary', async route => {
        summaryRequests.push(route.request().postDataJSON());
        await route.fulfill({ status: scenario.status || 200, json: scenario.response || { summary: theme, cached: false } });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    const toggle = page.getByRole('button', { name: /Weekly Reflection/ });
    const summaryResponse = page.waitForResponse(response => response.url().endsWith('/api/reflection-summary'));
    await toggle.click();
    await (await summaryResponse).finished();
    const card = page.locator('div').filter({
        has: page.locator(':scope > div', { hasText: /^想改變的事$/ }),
    }).first();
    const themeLabel = card.getByText('Theme', { exact: true });
    const cloudLabel = card.getByText('Themes', { exact: true });
    if (scenario.response) {
        await expect(themeLabel).not.toBeVisible();
        await expect(card).not.toContainText(theme);
    } else {
        await expect(themeLabel).toBeVisible();
        await expect(card).toContainText(theme);
    }
    await expect(cloudLabel).toBeVisible();
    await expect(card.getByText('focused', { exact: true })).toBeVisible();
    for (const text of ['focused reading', 'focused writing', 'focused learning']) {
        const entries = card.getByText(text, { exact: true });
        await expect(entries).toHaveCount(7);
        for (const entry of await entries.all()) await expect(entry).toBeVisible();
    }
    if (!scenario.response) {
        const themeBox = await themeLabel.boundingBox();
        const cloudBox = await cloudLabel.boundingBox();
        expect(themeBox.y + themeBox.height).toBeLessThanOrEqual(cloudBox.y);
    }
    expect(summaryRequests.length).toBeGreaterThan(0);
    expect(summaryRequests.every(body => body.promptId === 'change')).toBeTruthy();
    const body = summaryRequests.at(-1);
    expect(body.entries).toHaveLength(7);
    expect(body.weekStart).toBe(body.entries[0].ds);
    expect(body.entries.every(entry => memoDates.has(entry.ds) && entry.text.includes('focused reading'))).toBeTruthy();
    await toggle.click();
    await expect(themeLabel).not.toBeVisible();
    await toggle.click();
    await expect(cloudLabel).toBeVisible();
    if (scenario.response) {
        await expect(themeLabel).not.toBeVisible();
        await expect(card.getByText('focused reading', { exact: true })).toHaveCount(7);
    } else {
        await expect(themeLabel).toBeVisible();
    }
});
}
