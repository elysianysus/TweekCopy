import assert from 'node:assert/strict';

const canonicalDate = value => value.split('-').map(Number).join('-');

// APIRequestContext reads bypass page routes, so these snapshots inspect the
// actual journals, not the rendering fixtures. Never create or clean up records.
export async function withReadOnlyReflectionFixtures(page, memos, run) {
    const dates = [...new Set(memos.flatMap(({ date }) => {
        const [y, m, d] = canonicalDate(date).split('-');
        return [`${y}-${m}-${d}`, `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`];
    }))];
    async function snapshot() {
        const result = [];
        for (const date of dates) {
            const response = await page.request.get(`/api/memos/by-date/${date}`);
            assert.ok(response.ok(), `Cannot verify journals for ${date}: HTTP ${response.status()}`);
            const records = await response.json();
            assert.ok(Array.isArray(records), `Invalid journal response for ${date}`);
            result.push([...records].sort((a, b) => String(a.id).localeCompare(String(b.id))));
        }
        return result;
    }
    const before = await snapshot();
    const blockedWrites = [];
    // Keep routes installed through page teardown, including when assertions fail.
    await page.route('**/api/**', async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === '/api/reflection-summary') {
            return route.fulfill({ json: { summary: '', cached: false, skipped: 'fixture' } });
        }
        if (/^\/api\/memos(?:\/|$)/.test(path)) {
            if (!['GET', 'HEAD'].includes(request.method())) {
                blockedWrites.push(`${request.method()} ${path}`);
                return route.abort('blockedbyclient');
            }
            if (path.startsWith('/api/memos/by-date/')) {
                const date = canonicalDate(decodeURIComponent(path.split('/').pop()));
                return route.fulfill({
                    json: memos.filter(memo => canonicalDate(memo.date) === date),
                });
            }
        }
        return route.fallback();
    });
    try {
        return await run();
    } finally {
        assert.deepStrictEqual(await snapshot(), before, 'Existing journals changed during the rendering test');
        assert.deepStrictEqual(blockedWrites, [], 'Rendering test attempted to modify memos');
    }
}
