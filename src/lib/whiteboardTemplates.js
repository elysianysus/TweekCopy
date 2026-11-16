// Thinking-tool templates inspired by the Japanese "思考ツール" notebook
// (Mandala 9×9, Coordinate Axis, Concentric Chart, 4-Panel Memo). Each
// builder returns an array of fully-formed Excalidraw scene elements
// anchored on a (centerX, centerY) point so the caller can drop the
// template at the current viewport centre.
//
// Element schema mirrors what @excalidraw/excalidraw expects in
// `updateScene({ elements })` — id, seed, versionNonce, version, etc.
// are all required by Excalidraw's reconciler.

function rid()   { return "tmpl-" + Math.random().toString(36).slice(2, 11); }
function nonce() { return Math.floor(Math.random() * 2 ** 31); }

function base(type, x, y, width, height, extras = {}) {
    return {
        id: rid(), type, x, y, width, height,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: nonce(),
        versionNonce: nonce(),
        version: 1,
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
        ...extras,
    };
}

function rectEl(x, y, w, h, extras = {}) {
    return base("rectangle", x, y, w, h, extras);
}

function lineEl(x1, y1, x2, y2, extras = {}) {
    const minX = Math.min(x1, x2), minY = Math.min(y1, y2);
    return base("line", minX, minY, Math.abs(x2 - x1), Math.abs(y2 - y1), {
        points: [[x1 - minX, y1 - minY], [x2 - minX, y2 - minY]],
        lastCommittedPoint: null,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: null,
        ...extras,
    });
}

function arrowEl(x1, y1, x2, y2, extras = {}) {
    return lineEl(x1, y1, x2, y2, { ...extras, endArrowhead: "arrow" });
    // Note: we keep type='line' rather than 'arrow' so the visual stays
    // a plain axis line; the arrowhead is enough indication.
}

function ellipseEl(cx, cy, r, extras = {}) {
    return base("ellipse", cx - r, cy - r, r * 2, r * 2, extras);
}

function textEl(x, y, text, opts = {}) {
    const fontSize = opts.fontSize || 14;
    const w = opts.width  || Math.max(40, text.length * fontSize * 0.55);
    const h = opts.height || Math.round(fontSize * 1.25);
    return base("text", x, y, w, h, {
        text, fontSize,
        fontFamily: 1,                       // Excalidraw default (Virgil)
        textAlign: opts.textAlign || "center",
        verticalAlign: opts.verticalAlign || "middle",
        baseline: Math.round(fontSize * 0.9),
        containerId: null,
        originalText: text,
        lineHeight: 1.25,
        autoResize: true,
    });
}

// ── Templates ────────────────────────────────────────────────────────

// Mandala 9×9: 81 cells arranged as a 3×3 outer grid of 3×3 inner grids.
// Centre cell = main goal; 8 surrounding cells = sub-goals; each sub-goal
// becomes the centre of its own 3×3 block.
export function mandala9x9({ centerX, centerY, cell = 60 }) {
    const total = 9 * cell;
    const x0 = centerX - total / 2;
    const y0 = centerY - total / 2;
    const els = [rectEl(x0, y0, total, total, { strokeWidth: 2 })];
    for (let i = 1; i < 9; i++) {
        const thick = i % 3 === 0 ? 2 : 1;
        els.push(lineEl(x0 + i * cell, y0, x0 + i * cell, y0 + total, { strokeWidth: thick }));
        els.push(lineEl(x0, y0 + i * cell, x0 + total, y0 + i * cell, { strokeWidth: thick }));
    }
    els.push(textEl(centerX - cell / 2, centerY - 10, "main goal", { width: cell, fontSize: 12 }));
    return els;
}

// Coordinate Axis: 2D quadrant chart with arrowheads on the axes and a
// soft dashed bounding box so the working area is obvious at first glance.
export function coordinateAxis({ centerX, centerY, size = 540 }) {
    const half = size / 2;
    return [
        rectEl(centerX - half, centerY - half, size, size, {
            strokeStyle: "dashed", strokeColor: "#cbd5e1",
        }),
        arrowEl(centerX - half, centerY, centerX + half, centerY),  // X axis
        arrowEl(centerX, centerY + half, centerX, centerY - half),  // Y axis
        textEl(centerX + half - 36, centerY + 6,  "+x", { fontSize: 12, width: 30 }),
        textEl(centerX + 6, centerY - half + 6, "+y", { fontSize: 12, width: 30 }),
    ];
}

// Concentric Chart: rings × radial slices for impact/timeframe layering
// (e.g. inner=now, middle=this quarter, outer=this year).
export function concentricChart({ centerX, centerY, radius = 260, rings = 3, slices = 12 }) {
    const els = [];
    for (let i = 1; i <= rings; i++) {
        els.push(ellipseEl(centerX, centerY, (radius / rings) * i, { strokeWidth: i === rings ? 2 : 1 }));
    }
    for (let i = 0; i < slices; i++) {
        const a = (i / slices) * Math.PI * 2 - Math.PI / 2; // start at top
        els.push(lineEl(
            centerX, centerY,
            centerX + Math.cos(a) * radius,
            centerY + Math.sin(a) * radius,
            { strokeColor: "#94a3b8" },
        ));
    }
    return els;
}

// 4-Panel Memo: 2 cols × 4 rows storyboard for outline / comic flow.
export function fourPanelMemo({ centerX, centerY, panelW = 200, panelH = 130, gap = 10 }) {
    const cols = 2, rows = 4;
    const totalW = panelW * cols + gap * (cols - 1);
    const totalH = panelH * rows + gap * (rows - 1);
    const x0 = centerX - totalW / 2;
    const y0 = centerY - totalH / 2;
    const els = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            els.push(rectEl(
                x0 + c * (panelW + gap),
                y0 + r * (panelH + gap),
                panelW, panelH,
                { roundness: { type: 3 } },
            ));
        }
    }
    return els;
}

export const TEMPLATES = [
    { key: "mandala",  label: "Mandala 9×9",      icon: "fa-table-cells-large", desc: "9×9 goal-decomposition grid",      build: mandala9x9     },
    { key: "axis",     label: "Coordinate Axis",  icon: "fa-arrows-up-down-left-right", desc: "2D quadrant chart",         build: coordinateAxis },
    { key: "circle",   label: "Concentric Chart", icon: "fa-bullseye",          desc: "Concentric rings × radial slices", build: concentricChart },
    { key: "4panel",   label: "4-Panel Memo",     icon: "fa-table-cells",       desc: "2×4 storyboard panels",            build: fourPanelMemo  },
];
