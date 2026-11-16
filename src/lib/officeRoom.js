// Pure helpers for the Muse Office view. Extracted so they can be unit
// tested without spinning up React or a DOM.

export const ROOM_COLS = 18;
export const ROOM_ROWS = 12;

export function computeDeskLayout(count) {
    const positions = [];
    if (count <= 0) return positions;
    const cols = Math.min(8, Math.max(3, Math.ceil(count / 2)));
    const rowsAvail = count <= cols ? 1 : 2;
    const startX = Math.floor((ROOM_COLS - cols * 2) / 2) + 1;
    const rowYs = rowsAvail === 1 ? [Math.floor(ROOM_ROWS / 2)] : [4, 8];
    let i = 0;
    for (const rowY of rowYs) {
        for (let c = 0; c < cols; c++) {
            if (i >= count) break;
            const x = startX + c * 2;
            positions.push({
                deskX: x, deskY: rowY,
                workerX: x, workerY: rowY - 1,
                interactX: x, interactY: rowY + 1,
            });
            i++;
        }
    }
    return positions;
}

export function isBlocked(workers, x, y) {
    if (x <= 0 || y <= 0 || x >= ROOM_COLS - 1 || y >= ROOM_ROWS - 1) return true;
    for (const w of workers) {
        if (w.deskX === x && w.deskY === y) return true;
        if (w.workerX === x && w.workerY === y) return true;
    }
    return false;
}

export function findAdjacentWorker(workers, px, py) {
    for (const w of workers) {
        if (w.interactX === px && w.interactY === py) return w;
        if (Math.abs(w.deskX - px) + Math.abs(w.deskY - py) === 1) return w;
    }
    return null;
}

export function summarizeJobs(jobs) {
    const bySkill = {};
    for (const j of jobs) {
        if (!bySkill[j.skillKey]) bySkill[j.skillKey] = [];
        bySkill[j.skillKey].push(j);
    }
    const out = {};
    for (const [k, list] of Object.entries(bySkill)) {
        const queued  = list.filter(j => j.status === "queued").length;
        const running = list.filter(j => j.status === "running").length;
        const recent  = list[0];
        out[k] = { list, queued, running, recent };
    }
    return out;
}
