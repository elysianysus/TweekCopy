import TurndownService from 'turndown';

const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
});

export function htmlToMarkdown(html) {
    if (!html) return '';
    return turndown.turndown(html);
}

export function memoToMarkdown(memo) {
    const frontmatter = [];
    frontmatter.push('---');
    if (memo.title) frontmatter.push(`title: "${memo.title.replace(/"/g, '\\"')}"`);
    if (memo.date) frontmatter.push(`date: "${memo.date}"`);
    frontmatter.push(`color: ${memo.color || 'white'}`);
    if (memo.tags && memo.tags.length > 0) {
        frontmatter.push(`tags:`);
        for (const tag of memo.tags) {
            frontmatter.push(`  - ${tag}`);
        }
    }
    frontmatter.push('---');
    frontmatter.push('');

    let content = memo.content || '';
    if (/<[a-z][\s\S]*>/i.test(content)) {
        content = htmlToMarkdown(content);
    }

    return frontmatter.join('\n') + content;
}

export function parseFrontmatter(text) {
    const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!match) return { meta: {}, content: text };

    const yamlBlock = match[1];
    const content = match[2];
    const meta = {};

    const lines = yamlBlock.split('\n');
    let currentKey = null;
    let currentArray = null;

    for (const line of lines) {
        const kvMatch = line.match(/^(\w+):\s*(.*)$/);
        if (kvMatch) {
            currentKey = kvMatch[1];
            let val = kvMatch[2].trim();
            if (val === '') {
                currentArray = [];
                meta[currentKey] = currentArray;
            } else {
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                if (val.startsWith('[') && val.endsWith(']')) {
                    meta[currentKey] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
                    currentArray = meta[currentKey];
                } else {
                    meta[currentKey] = val;
                    currentArray = null;
                }
            }
        } else {
            const arrayItemMatch = line.match(/^\s+-\s+(.+)$/);
            if (arrayItemMatch && currentArray) {
                let val = arrayItemMatch[1].trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                currentArray.push(val);
            }
        }
    }

    return { meta, content };
}

export function sanitizeFilename(name) {
    return (name || 'untitled').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').slice(0, 80);
}

export async function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export async function downloadZip(files) {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const { name, content } of files) {
        zip.file(name, content);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'memos-export.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}
