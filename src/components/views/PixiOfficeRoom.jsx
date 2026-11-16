// B · Pixi-rendered Muse Office room. Replaces the original CSS-grid render
// with a real WebGL canvas so we get smooth bobbing animations, crisp
// pixel-art floor tiles, and per-frame interpolated player movement. Only
// the GAME LAYER (floor, walls, desks, worker sprites, player sprite) lives
// here — name labels, status / reaction bubbles, the "press E" prompt and
// the worker dialog stay as React overlays absolutely-positioned on top of
// this canvas in OfficeView.jsx, so we keep React's flexible HUD layout.
import React, { useEffect, useRef } from "react";
import { Application, Container, Graphics } from "pixi.js";
import { ROOM_COLS, ROOM_ROWS } from "../../lib/officeRoom.js";

export const CELL = 36;

// Tailwind text-color → 24-bit int for Pixi fills. Mirrors COLOR_HEX in
// OfficeView so worker shirt colors stay consistent across the two layers.
const COLOR_INT = {
  "text-gray-500":   0x6b7280,
  "text-orange-500": 0xf97316,
  "text-pink-500":   0xec4899,
  "text-teal-500":   0x14b8a6,
  "text-yellow-500": 0xeab308,
  "text-blue-500":   0x3b82f6,
  "text-blue-400":   0x60a5fa,
  "text-amber-600":  0xd97706,
  "text-cyan-500":   0x06b6d4,
  "text-indigo-500": 0x6366f1,
  "text-red-600":    0xdc2626,
  "text-purple-500": 0xa855f7,
  "text-emerald-500":0x10b981,
  "text-rose-500":   0xf43f5e,
  "text-red-500":    0xef4444,
  "text-amber-500":  0xf59e0b,
  "text-lime-500":   0x84cc16,
  "text-green-500":  0x22c55e,
  "text-sky-500":    0x0ea5e9,
  "text-violet-500": 0x8b5cf6,
};
function colorInt(c) { return COLOR_INT[c] ?? 0x6b7280; }

const FLOOR_LIGHT = 0xfef3c7;   // amber-100
const FLOOR_DARK  = 0xfde68a;   // amber-200
const WALL_FILL   = 0xd4a274;   // wood beam
const WALL_LINE   = 0x8b5a2b;
const DESK_FILL   = 0xa16207;   // amber-700
const DESK_SHADE  = 0x713f12;
const SKIN_FILL   = 0xfbcfa8;
const PLAYER_HEAD = 0xfde68a;
const PLAYER_BODY = 0x1f2937;

export default function PixiOfficeRoom({
  workers,           // [{ key, color, deskX, deskY, workerX, workerY }]
  player,            // { x, y }   in cell coords
  jobSummary,        // { [skillKey]: { queued, running } }
  onWorkerClick,     // (skillKey) => void
}) {
  const hostRef = useRef(null);
  const appRef = useRef(null);
  const layersRef = useRef(null);
  const workerSpritesRef = useRef(new Map());
  const playerSpriteRef = useRef(null);
  // Integer cell-coord target the player is moving toward + a fractional
  // visual position the ticker eases toward it (for smooth slide animation).
  const playerTargetRef = useRef({ x: player.x, y: player.y });
  const playerVisualRef = useRef({ x: player.x, y: player.y });

  // ── Pixi app lifecycle ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const app = new Application();
    appRef.current = app;
    app.init({
      width: ROOM_COLS * CELL,
      height: ROOM_ROWS * CELL,
      background: FLOOR_LIGHT,
      antialias: false,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
    }).then(() => {
      if (cancelled || !appRef.current) {
        try { app.destroy(true, { children: true, texture: true }); } catch {}
        return;
      }
      hostRef.current?.appendChild(app.canvas);
      app.canvas.style.imageRendering = "pixelated";
      app.canvas.style.display = "block";

      // Build static layers up-front so re-renders of the worker list only
      // touch the desks + worker container, never re-paint floor/walls.
      const floor = new Graphics();
      const walls = new Graphics();
      const desks = new Graphics();
      const workerLayer = new Container();
      const playerLayer = new Container();
      app.stage.addChild(floor, walls, desks, workerLayer, playerLayer);
      drawFloor(floor);
      drawWalls(walls);
      layersRef.current = { floor, walls, desks, workerLayer, playerLayer };

      // Player sprite (built once; ticker just nudges its position).
      const ps = makePlayerSprite();
      ps.x = player.x * CELL;
      ps.y = player.y * CELL;
      playerLayer.addChild(ps);
      playerSpriteRef.current = ps;

      // Per-frame ticker: worker idle bob / busy wiggle + smooth player slide.
      let t = 0;
      app.ticker.add((ticker) => {
        t += ticker.deltaMS / 1000;
        for (const entry of workerSpritesRef.current.values()) {
          const { body, busy, baseBodyY, phase } = entry;
          if (busy) {
            body.rotation = Math.sin(t * 9 + phase) * 0.18;
            body.y = baseBodyY;
          } else {
            body.rotation = 0;
            body.y = baseBodyY + Math.sin(t * 2.4 + phase) * 1.2;
          }
        }
        const target = playerTargetRef.current;
        const cur = playerVisualRef.current;
        cur.x += (target.x - cur.x) * Math.min(1, ticker.deltaMS / 70);
        cur.y += (target.y - cur.y) * Math.min(1, ticker.deltaMS / 70);
        const ps = playerSpriteRef.current;
        if (ps) {
          ps.x = cur.x * CELL;
          ps.y = cur.y * CELL;
          // Tiny squash on movement.
          const moving = Math.hypot(target.x - cur.x, target.y - cur.y) > 0.05;
          ps.scale.y = moving ? 1 - Math.abs(Math.sin(t * 14)) * 0.06 : 1;
        }
      });
    }).catch(() => { /* init failed — leave host empty, React overlays still work */ });

    return () => {
      cancelled = true;
      const a = appRef.current;
      appRef.current = null;
      layersRef.current = null;
      workerSpritesRef.current.clear();
      playerSpriteRef.current = null;
      if (a) {
        try { a.destroy(true, { children: true, texture: true }); } catch {}
      }
    };
    // We intentionally only init once. Subsequent prop changes flow through
    // the dedicated sync effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync workers whenever the list / busy state changes. ──────────────
  useEffect(() => {
    let cancelled = false;
    function trySync() {
      if (cancelled) return;
      const layers = layersRef.current;
      if (!layers) { setTimeout(trySync, 40); return; }
      syncWorkers(layers, workers, jobSummary, workerSpritesRef.current, onWorkerClick);
    }
    trySync();
    return () => { cancelled = true; };
  }, [workers, jobSummary, onWorkerClick]);

  // ── Sync the player target when the React state changes. ──────────────
  useEffect(() => {
    playerTargetRef.current = { x: player.x, y: player.y };
  }, [player.x, player.y]);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0"
      style={{ width: ROOM_COLS * CELL, height: ROOM_ROWS * CELL }}
      aria-hidden="true"
    />
  );
}

// ── Drawing helpers ─────────────────────────────────────────────────────

function drawFloor(g) {
  g.clear();
  for (let y = 0; y < ROOM_ROWS; y++) {
    for (let x = 0; x < ROOM_COLS; x++) {
      const fill = (x + y) % 2 === 0 ? FLOOR_LIGHT : FLOOR_DARK;
      g.rect(x * CELL, y * CELL, CELL, CELL).fill(fill);
    }
  }
}

function drawWalls(g) {
  g.clear();
  const W = ROOM_COLS * CELL;
  const H = ROOM_ROWS * CELL;
  // Solid wood frame.
  g.rect(0, 0, W, CELL).fill(WALL_FILL);
  g.rect(0, H - CELL, W, CELL).fill(WALL_FILL);
  g.rect(0, 0, CELL, H).fill(WALL_FILL);
  g.rect(W - CELL, 0, CELL, H).fill(WALL_FILL);
  // Plank seams: horizontal lines across the top/bottom beams + vertical
  // lines across the side beams give the wall a chunky pixel-art feel.
  for (let i = 0; i < ROOM_COLS; i += 2) {
    g.rect(i * CELL, CELL - 2, 1, 2).fill({ color: WALL_LINE, alpha: 0.45 });
    g.rect(i * CELL, H - CELL, 1, 2).fill({ color: WALL_LINE, alpha: 0.45 });
  }
  for (let i = 0; i < ROOM_ROWS; i += 2) {
    g.rect(CELL - 2, i * CELL, 2, 1).fill({ color: WALL_LINE, alpha: 0.45 });
    g.rect(W - CELL, i * CELL, 2, 1).fill({ color: WALL_LINE, alpha: 0.45 });
  }
}

function syncWorkers(layers, workers, jobSummary, map, onWorkerClick) {
  const { workerLayer, desks } = layers;
  // Repaint desks (cheap, and keeps them in sync with the worker list).
  desks.clear();
  for (const w of workers) {
    const x = w.deskX * CELL + 2;
    const y = w.deskY * CELL + 4;
    desks.roundRect(x, y, CELL - 4, CELL - 8, 4).fill(DESK_FILL);
    // Desk shadow lip for depth.
    desks.rect(x, y + (CELL - 8) - 3, CELL - 4, 3).fill({ color: DESK_SHADE, alpha: 0.5 });
  }
  // Diff worker sprites: create new ones, refresh existing, remove stale.
  const seen = new Set();
  for (const w of workers) {
    seen.add(w.key);
    const summary = jobSummary[w.key];
    const busy = !!(summary && (summary.running > 0 || summary.queued > 0));
    let entry = map.get(w.key);
    if (!entry) {
      entry = makeWorkerSprite(w);
      entry.container.eventMode = "static";
      entry.container.cursor = "pointer";
      entry.onTap = () => onWorkerClick?.(w.key);
      entry.container.on("pointertap", entry.onTap);
      workerLayer.addChild(entry.container);
      map.set(w.key, entry);
    } else {
      // Click handler may have changed identity across renders.
      entry.container.off("pointertap", entry.onTap);
      entry.onTap = () => onWorkerClick?.(w.key);
      entry.container.on("pointertap", entry.onTap);
    }
    entry.container.x = w.workerX * CELL;
    entry.container.y = w.workerY * CELL;
    entry.busy = busy;
  }
  for (const [key, entry] of map.entries()) {
    if (!seen.has(key)) {
      entry.container.off("pointertap", entry.onTap);
      workerLayer.removeChild(entry.container);
      entry.container.destroy({ children: true });
      map.delete(key);
    }
  }
}

function makeWorkerSprite(w) {
  const c = colorInt(w.color);
  const container = new Container();
  // Body: rounded rect pivoted at its centre so we can rotate it for the
  // "wiggle while busy" animation without warping its position.
  const body = new Graphics()
    .roundRect(-9, -7, 18, 14, 3)
    .fill(c)
    // Subtle highlight band across the top of the shirt for depth.
    .rect(-9, -7, 18, 2)
    .fill({ color: 0xffffff, alpha: 0.18 });
  body.x = CELL / 2;
  body.y = 23;
  const baseBodyY = body.y;
  // Head sits ABOVE the body (smaller, skin-toned, color-bordered).
  const head = new Graphics()
    .roundRect(-7, -7, 14, 14, 2)
    .fill(SKIN_FILL)
    .stroke({ width: 2, color: c });
  head.x = CELL / 2;
  head.y = 9;
  // Tiny shadow ellipse on the floor for grounding.
  const shadow = new Graphics()
    .ellipse(CELL / 2, CELL - 3, 9, 2.5)
    .fill({ color: 0x000000, alpha: 0.22 });
  container.addChild(shadow, body, head);
  return {
    container, body, head, shadow,
    baseBodyY,
    phase: hashPhase(w.key),
    busy: false,
  };
}

function makePlayerSprite() {
  const container = new Container();
  const shadow = new Graphics()
    .ellipse(CELL / 2, CELL - 3, 9, 2.5)
    .fill({ color: 0x000000, alpha: 0.3 });
  const body = new Graphics()
    .roundRect(-9, -7, 18, 14, 3).fill(PLAYER_BODY)
    .rect(-9, -7, 18, 2).fill({ color: 0xffffff, alpha: 0.15 });
  body.x = CELL / 2;
  body.y = 23;
  const head = new Graphics()
    .roundRect(-7, -7, 14, 14, 2).fill(PLAYER_HEAD)
    .stroke({ width: 2, color: PLAYER_BODY });
  head.x = CELL / 2;
  head.y = 9;
  // Cute hair tuft.
  const tuft = new Graphics()
    .rect(CELL / 2 - 2, 0, 4, 3).fill(PLAYER_BODY);
  container.addChild(shadow, body, head, tuft);
  return container;
}

// Stable phase per worker key so each one bobs out-of-sync with its peers.
function hashPhase(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return ((h % 1000) / 1000) * Math.PI * 2;
}
