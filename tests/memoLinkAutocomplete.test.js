import test from 'node:test';
import assert from 'node:assert/strict';
import { findMemoLink, insertMemoLink, filterMemoLinks } from '../src/scripts/memoLinkAutocomplete.js';

test('opens on [[ and supports Chinese titles', () => {
    assert.deepEqual(findMemoLink('Hello [[', 8), { start: 6, end: 8, query: '' });
    assert.deepEqual(insertMemoLink('[[日', 3, '日記'), { value: '[[日記]]', cursor: 6 });
});
test('replaces existing closing brackets and partial title, preserving suffix', () => {
    assert.equal(insertMemoLink('A [[old]] tail', 6, 'New').value, 'A [[New]] tail');
    assert.equal(insertMemoLink('A [[ol]] tail', 6, 'New').value, 'A [[New]] tail');
    assert.equal(insertMemoLink('[[Ne tail', 4, 'New').value, '[[New]] tail');
});
test('does not open across lines, completed links or selections', () => {
    for (const text of ['[[abc\nnext', '[[Done]]', 'nothing', '[single']) {
        assert.equal(findMemoLink(text, text.length), null);
    }
    assert.equal(findMemoLink('[[abc', 2, 5), null);
    assert.equal(insertMemoLink('[[', 2, 'bad]]title'), null);
});
test('filters case-insensitively and handles empty and malformed titles', () => {
    const titles = [{ id: 1, title: 'Daily' }, { id: 2, title: '日記' }, { id: 3, title: '' }, { id: 4, title: null }];
    assert.deepEqual(filterMemoLinks(titles, 'DAI').map(n => n.id), [1]);
    assert.deepEqual(filterMemoLinks(titles, '日').map(n => n.id), [2]);
    assert.equal(filterMemoLinks(titles, '').length, 2);
    assert.equal(filterMemoLinks(titles, 'missing').length, 0);
});
