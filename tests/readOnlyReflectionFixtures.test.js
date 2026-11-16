import test from 'node:test';
import assert from 'node:assert/strict';
import { withReadOnlyReflectionFixtures } from './helpers/readOnlyReflectionFixtures.js';

function harness() {
    const journals = [
        { id: 41, date: '2026-10-5', content: '<!-- tweek:reflection -->\nMy existing journal' },
        { id: 42, date: '2026-10-05', content: 'Ordinary memo that must also survive' },
    ];
    const original = structuredClone(journals);
    const apiReads = [];
    let handler;
    const page = {
        request: {
            async get(url) {
                apiReads.push(url);
                return { ok: () => true, status: () => 200, json: async () => structuredClone(journals) };
            },
            post() { throw new Error('Unexpected persisted creation'); },
            delete() { throw new Error('Unexpected persisted deletion'); },
        },
        async route(_pattern, callback) { handler = callback; },
    };
    async function request(path, method = 'GET') {
        let result;
        await handler({
            request: () => ({ url: () => `https://example.test${path}`, method: () => method }),
            fulfill: async response => { result = response.json; },
            abort: async () => { result = 'blocked'; },
            fallback: async () => { result = 'network'; },
        });
        return result;
    }
    return { page, journals, original, apiReads, request };
}

const memos = [{ id: 900001, date: '2026-10-5', content: 'Only a rendering fixture' }];

for (const fails of [false, true]) {
    test(`existing journals survive ${fails ? 'failed' : 'successful'} rendering and teardown`, async () => {
        const h = harness();
        const failure = new Error('Simulated failed browser assertion');
        const run = withReadOnlyReflectionFixtures(h.page, memos, async () => {
            assert.deepEqual(await h.request('/api/memos/by-date/2026-10-05'), memos);
            assert.deepEqual(await h.request('/api/memos/by-date/2026-10-5'), memos);
            assert.deepEqual(await h.request('/api/memos/by-date/2026-10-6'), []);
            assert.notEqual(await h.request('/api/reflection-summary', 'POST'), 'network');
            if (fails) throw failure;
        });
        if (fails) await assert.rejects(run, error => error === failure);
        else await run;
        assert.deepEqual(h.journals, h.original);
        assert.equal(h.apiReads.length, 4, 'real journal snapshots run before and after, even on failure');
        assert.equal(await h.request('/api/memos/41', 'DELETE'), 'blocked', 'teardown retains the write guard');
        assert.deepEqual(h.journals, h.original);
    });
}

test('memo writes are blocked and fail the test instead of reaching the server', async () => {
    const h = harness();
    await assert.rejects(withReadOnlyReflectionFixtures(h.page, memos, async () => {
        for (const [path, method] of [['/api/memos', 'POST'], ['/api/memos/41', 'PATCH'], ['/api/memos/41', 'DELETE']]) {
            assert.equal(await h.request(path, method), 'blocked');
        }
    }), /attempted to modify memos/);
    assert.deepEqual(h.journals, h.original);
});

test('snapshot verification detects changes rather than silently accepting them', async () => {
    const h = harness();
    await assert.rejects(withReadOnlyReflectionFixtures(h.page, memos, async () => {
        h.journals[0].content = 'External edit';
    }), /Existing journals changed/);
});
