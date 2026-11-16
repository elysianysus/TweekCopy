export function findMemoLink(text, cursor, selectionEnd = cursor) {
    if (cursor !== selectionEnd) return null;
    const match = text.slice(0, cursor).match(/\[\[([^[\]\r\n]*)$/);
    if (!match) return null;
    const suffix = text.slice(cursor).match(/^[^[\]\r\n]*\]\]/);
    return { start: cursor - match[0].length, end: cursor + (suffix?.[0].length || 0), query: match[1] };
}

export function insertMemoLink(text, cursor, title, selectionEnd = cursor) {
    const range = findMemoLink(text, cursor, selectionEnd);
    if (!range || /[\r\n[\]]/.test(title)) return null;
    const link = `[[${title}]]`;
    return { value: text.slice(0, range.start) + link + text.slice(range.end), cursor: range.start + link.length };
}

export function filterMemoLinks(titles, query) {
    const needle = query.trim().toLocaleLowerCase();
    return titles.filter(item => typeof item.title === 'string' && item.title.trim() && !/[\r\n[\]]/.test(item.title))
        .filter(item => item.title.toLocaleLowerCase().includes(needle))
        .slice(0, 8);
}
