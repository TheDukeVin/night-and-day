// The level editor (`/editor`): a top-down plan view for building Skyway-style
// platformer levels — draw stone platforms, drop pushable crates, place
// generators on top of them — plus the level's math (starting crystals,
// outputs, solution) and a one-click play test in the real game.
//
// The plan view looks straight down: +x runs right, +z runs DOWN the screen,
// which is toward the camera in game. So the bottom of the canvas is where the
// players spawn and the top is the far distance — the same way you'd sketch the
// level on paper facing it.
//
// Levels you build are plain `LevelDef` JSON, the exact shape `shared/levels.ts`
// and `shared/skyway.ts` hold, so "Download" gives you something you can paste
// straight into a pack.

import { COLOR_HEX } from '../game/crystals.ts';
import { GameController } from '../game/level.ts';
import { LoopbackChannel } from '../net/client.ts';
import { registerPack } from '../../../shared/packs.ts';
import { BOX_SIZE } from '../../../shared/skyway.ts';
import { surfaceUnder, validateLevel } from '../../../shared/validate.ts';
import type {
  BoxDef,
  CrystalColor,
  ExtendDirection,
  ExtendingPlatformDef,
  GeneratorDef,
  LevelDef,
  PlatformDef,
  Side,
} from '../../../shared/types.ts';
import { button, clearUI, el, showDialog, uiRoot } from '../screens/ui.ts';
import { solveLevel } from './solve.ts';

const ALL_COLORS: CrystalColor[] = ['red', 'blue', 'green', 'yellow', 'purple'];
const ALL_DIRECTIONS: ExtendDirection[] = ['+x', '-x', '+z', '-z', '+y', '-y'];

/** How each direction reads in the plan view (+z runs DOWN the screen). */
const DIRECTION_LABEL: Record<ExtendDirection, string> = {
  '+x': '→ right',
  '-x': '← left',
  '+z': '↓ toward the start',
  '-z': '↑ into the distance',
  '+y': '▲ up',
  '-y': '▼ down',
};

const STORAGE_KEY = 'night-and-day-editor';

/** Pack id the play test registers under; overwritten on every test run. */
const DRAFT_PACK_ID = 'draft';

type Tool = 'select' | 'platform' | 'extender' | 'crate' | 'generator' | 'spawn' | 'erase';

/** What the pointer currently has hold of. */
type Selection =
  | { kind: 'platform'; id: string }
  | { kind: 'extender'; id: string }
  | { kind: 'crate'; id: string }
  | { kind: 'generator'; id: string }
  | null;

interface EditorPack {
  id: string;
  name: string;
  icon: string;
  description: string;
  levels: LevelDef[];
}

interface View {
  /** World point at the center of the canvas. */
  ox: number;
  oz: number;
  /** Pixels per world unit. */
  scale: number;
}

// ---------- Module state ----------

let pack: EditorPack = blankPack();
let currentIndex = 0;
let tool: Tool = 'select';
let selection: Selection = null;
/** Side and height used for the next thing placed. */
let newSide: Side = 'day';
let newHeight = 2;
/** Direction and reach used for the next extending platform placed. */
let newDir: ExtendDirection = '+x';
let newLength = 6;
let view: View = { ox: 0, oz: 14, scale: 13 };

let root: HTMLElement;
let canvas: HTMLCanvasElement;
let panel: HTMLElement;
let statusLine: HTMLElement;

const level = (): LevelDef => pack.levels[currentIndex];

// ---------- Blank documents ----------

function blankPack(): EditorPack {
  return {
    id: 'my-pack',
    name: 'My Pack',
    icon: '🧗',
    description: 'Levels I made',
    levels: [blankLevel(1)],
  };
}

function blankLevel(index: number): LevelDef {
  return {
    index,
    name: `Level ${index}`,
    concept: 'Jumping and pushing',
    initial: { red: { day: 0, night: 2 } },
    generators: [],
    solution: {},
    terrain: { spawn: { x: 0, z: 28 }, platforms: [], boxes: [], extenders: [] },
  };
}

/** The level's extending platforms, created on demand for older drafts. */
function extendersOf(lv: LevelDef): ExtendingPlatformDef[] {
  const terrain = lv.terrain!;
  terrain.extenders ??= [];
  return terrain.extenders;
}

// ---------- Entry point ----------

export function runEditor(): void {
  document.title = 'Night and Day — Level Editor';
  load();
  clearUI();
  render();
  window.addEventListener('resize', drawCanvas);
  window.addEventListener('keydown', onKeyDown);
}

// ---------- Persistence ----------

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ pack, currentIndex }));
  } catch {
    // Storage unavailable (private browsing) — the editor still works, it just
    // won't survive a refresh. Download is the real save button.
  }
}

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { pack: EditorPack; currentIndex: number };
    if (saved.pack?.levels?.length) {
      pack = saved.pack;
      currentIndex = Math.min(saved.currentIndex ?? 0, pack.levels.length - 1);
    }
  } catch {
    // Corrupt draft: start fresh rather than refusing to open the editor.
  }
}

/** Anything that changed the level: re-settle geometry, redraw, persist. */
function changed(rebuildPanel = true): void {
  resettle();
  save();
  drawCanvas();
  if (rebuildPanel) buildPanel();
  refreshStatus();
}

/**
 * Drop every crate and generator onto whatever is beneath it. Moving a platform
 * would otherwise leave things floating, and a floating generator is a level
 * the verifier rejects — so the editor simply never lets that state exist.
 * Crates settle bottom-up so a stack lands in the right order.
 */
function resettle(): void {
  const lv = level();
  const boxes = [...(lv.terrain?.boxes ?? [])].sort((a, b) => a.y - b.y);
  for (const b of boxes) b.y = surfaceUnder(lv, b.x, b.z, b.id);
  for (const g of lv.generators) {
    if (g.at) g.at.y = surfaceUnder(lv, g.at.x, g.at.z);
  }
}

// ---------- Layout ----------

function render(): void {
  root = el('div', { className: 'editor' });
  const wrap = el('div', { className: 'editor-stage' });
  canvas = el('canvas', { className: 'editor-canvas' });
  wrap.append(canvas);
  wrap.append(
    el('div', {
      className: 'editor-legend',
      html:
        '<b>Plan view</b> — looking straight down. ' +
        'The bottom of the map is where players start; the crystal rings sit in the middle.<br/>' +
        'Drag with the <b>right mouse button</b> to pan, <b>scroll</b> to zoom, <b>Delete</b> to remove what is selected.',
    })
  );
  statusLine = el('div', { className: 'editor-status' });
  wrap.append(statusLine);
  root.append(wrap);

  panel = el('aside', { className: 'editor-panel' });
  root.append(panel);
  uiRoot().append(root);

  attachCanvasEvents();
  buildPanel();
  drawCanvas();
  refreshStatus();
}

// ---------- Canvas: coordinate transforms ----------

function toScreen(wx: number, wz: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (wx - view.ox) * view.scale + rect.width / 2,
    y: (wz - view.oz) * view.scale + rect.height / 2,
  };
}

function toWorld(sx: number, sy: number): { x: number; z: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (sx - rect.width / 2) / view.scale + view.ox,
    z: (sy - rect.height / 2) / view.scale + view.oz,
  };
}

/** Level geometry is authored on whole world units — that is what reads well. */
const snap = (v: number): number => Math.round(v);

// ---------- Canvas: drawing ----------

function drawCanvas(): void {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  ctx.fillStyle = '#221a33';
  ctx.fillRect(0, 0, rect.width, rect.height);

  drawGrid(ctx, rect);
  drawCrystalZones(ctx);

  const lv = level();
  // Lowest platforms first, so a tall one drawn over a short one reads as "on top".
  for (const p of [...(lv.terrain?.platforms ?? [])].sort((a, b) => a.y - b.y)) drawPlatform(ctx, p);
  for (const e of lv.terrain?.extenders ?? []) drawExtender(ctx, e);
  for (const b of lv.terrain?.boxes ?? []) drawCrate(ctx, b);
  for (const g of lv.generators) drawGenerator(ctx, g);
  drawSpawn(ctx);
  if (drag?.kind === 'draw-platform') drawPendingPlatform(ctx, drag);
}

function drawGrid(ctx: CanvasRenderingContext2D, rect: DOMRect): void {
  const topLeft = toWorld(0, 0);
  const bottomRight = toWorld(rect.width, rect.height);
  for (let x = Math.floor(topLeft.x); x <= bottomRight.x; x++) {
    const major = x % 5 === 0;
    if (!major && view.scale < 9) continue;
    ctx.strokeStyle = x === 0 ? 'rgba(255,220,160,0.5)' : major ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const sx = Math.round(toScreen(x, 0).x) + 0.5;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, rect.height);
    ctx.stroke();
  }
  for (let z = Math.floor(topLeft.z); z <= bottomRight.z; z++) {
    const major = z % 5 === 0;
    if (!major && view.scale < 9) continue;
    ctx.strokeStyle = z === 0 ? 'rgba(255,220,160,0.5)' : major ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const sy = Math.round(toScreen(0, z).y) + 0.5;
    ctx.moveTo(0, sy);
    ctx.lineTo(rect.width, sy);
    ctx.stroke();
  }
}

/**
 * The two crystal platforms are placed by the game, not the author — draw them
 * as no-build zones so nothing gets buried inside one. Their footprint grows
 * with the number of colors the level uses, exactly as `CrystalField` builds it.
 */
function drawCrystalZones(ctx: CanvasRenderingContext2D): void {
  const depth = Math.max(1, colorsOf(level()).length) * 6 + 4;
  const halfZ = (5.0 * depth) / 8.8;
  for (const [x, tint] of [
    [-10, 'rgba(255,199,118,'],
    [10, 'rgba(142,166,255,'],
  ] as [number, string][]) {
    const a = toScreen(x - 5, -halfZ);
    const b = toScreen(x + 5, halfZ);
    ctx.fillStyle = `${tint}0.10)`;
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeStyle = `${tint}0.45)`;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.setLineDash([]);
    ctx.fillStyle = `${tint}0.7)`;
    ctx.font = '11px Trebuchet MS';
    ctx.textAlign = 'center';
    ctx.fillText(x < 0 ? 'day crystals' : 'night crystals', (a.x + b.x) / 2, a.y - 6);
  }
}

/** Taller platforms are lighter, so height reads at a glance from above. */
function stoneShade(y: number): string {
  const t = Math.min(1, y / 8);
  const c = Math.round(95 + t * 95);
  return `rgb(${c}, ${c - 6}, ${Math.round(c * 0.88)})`;
}

function drawPlatform(ctx: CanvasRenderingContext2D, p: PlatformDef): void {
  const a = toScreen(p.x - p.w / 2, p.z - p.d / 2);
  const b = toScreen(p.x + p.w / 2, p.z + p.d / 2);
  ctx.fillStyle = stoneShade(p.y);
  ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  strokeSelectable(ctx, a, b, selection?.kind === 'platform' && selection.id === p.id);
  ctx.fillStyle = 'rgba(20,12,30,0.85)';
  ctx.font = 'bold 12px Trebuchet MS';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`▲ ${p.y}`, (a.x + b.x) / 2, (a.y + b.y) / 2);
}

/**
 * The footprint the arm covers when fully out, or null for the two vertical
 * directions — those grow toward or away from the viewer, so from straight above
 * there is nothing extra to draw.
 */
function armFootprint(e: ExtendingPlatformDef): { x0: number; z0: number; x1: number; z1: number } | null {
  const hw = e.w / 2;
  const hd = e.d / 2;
  switch (e.dir) {
    case '+x':
      return { x0: e.x + hw, z0: e.z - hd, x1: e.x + hw + e.length, z1: e.z + hd };
    case '-x':
      return { x0: e.x - hw - e.length, z0: e.z - hd, x1: e.x - hw, z1: e.z + hd };
    case '+z':
      return { x0: e.x - hw, z0: e.z + hd, x1: e.x + hw, z1: e.z + hd + e.length };
    case '-z':
      return { x0: e.x - hw, z0: e.z - hd - e.length, x1: e.x + hw, z1: e.z - hd };
    default:
      return null;
  }
}

function drawExtender(ctx: CanvasRenderingContext2D, e: ExtendingPlatformDef): void {
  // The arm first, dashed: it is where the platform WILL be, not where it is.
  const arm = armFootprint(e);
  if (arm) {
    const a = toScreen(arm.x0, arm.z0);
    const b = toScreen(arm.x1, arm.z1);
    ctx.fillStyle = 'rgba(240,244,255,0.18)';
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeStyle = 'rgba(240,244,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.setLineDash([]);
  }

  const a = toScreen(e.x - e.w / 2, e.z - e.d / 2);
  const b = toScreen(e.x + e.w / 2, e.z + e.d / 2);
  ctx.fillStyle = '#eef1ff';
  ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  strokeSelectable(ctx, a, b, selection?.kind === 'extender' && selection.id === e.id);

  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  ctx.fillStyle = 'rgba(20,12,30,0.85)';
  ctx.font = 'bold 12px Trebuchet MS';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${DIRECTION_LABEL[e.dir].charAt(0)} ${e.y}`, cx, cy);
  // The condition, in the same words the mini crystals say it in game.
  ctx.fillStyle = COLOR_HEX[e.when.color].ui;
  ctx.font = 'bold 11px Trebuchet MS';
  ctx.fillText(`${e.when.side === 'day' ? '☀' : '🌙'} ${e.when.count} ${e.when.color}`, cx, b.y + 10);
}

function drawCrate(ctx: CanvasRenderingContext2D, box: BoxDef): void {
  const a = toScreen(box.x - BOX_SIZE / 2, box.z - BOX_SIZE / 2);
  const b = toScreen(box.x + BOX_SIZE / 2, box.z + BOX_SIZE / 2);
  ctx.fillStyle = '#b59263';
  ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.strokeStyle = '#ffe0a8';
  ctx.lineWidth = 2;
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  // The diagonals echo the crate's glowing edges in game.
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.moveTo(b.x, a.y);
  ctx.lineTo(a.x, b.y);
  ctx.stroke();
  strokeSelectable(ctx, a, b, selection?.kind === 'crate' && selection.id === box.id);
}

function drawGenerator(ctx: CanvasRenderingContext2D, g: GeneratorDef): void {
  const at = g.at ?? { x: 0, y: 0, z: 0 };
  const c = toScreen(at.x, at.z);
  const r = Math.max(7, 1.5 * view.scale);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fillStyle = g.side === 'day' ? 'rgba(255,199,118,0.9)' : 'rgba(142,166,255,0.9)';
  ctx.fill();
  ctx.lineWidth = selection?.kind === 'generator' && selection.id === g.id ? 3 : 1.5;
  ctx.strokeStyle = selection?.kind === 'generator' && selection.id === g.id ? '#ffffff' : 'rgba(20,12,30,0.7)';
  ctx.stroke();

  ctx.fillStyle = '#1a1226';
  ctx.font = 'bold 11px Trebuchet MS';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(g.id, c.x, c.y);
  ctx.fillStyle = '#f4e9ff';
  ctx.font = '11px Trebuchet MS';
  ctx.fillText(outputText(g), c.x, c.y + r + 9);
  if (at.y > 0) ctx.fillText(`▲ ${at.y}`, c.x, c.y + r + 21);
}

function drawSpawn(ctx: CanvasRenderingContext2D): void {
  const spawn = level().terrain?.spawn;
  if (!spawn) return;
  const c = toScreen(spawn.x, spawn.z);
  ctx.strokeStyle = '#e8b3ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c.x, c.y, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c.x, c.y - 14);
  ctx.lineTo(c.x, c.y + 14);
  ctx.moveTo(c.x - 14, c.y);
  ctx.lineTo(c.x + 14, c.y);
  ctx.stroke();
  ctx.fillStyle = '#e8b3ff';
  ctx.font = '11px Trebuchet MS';
  ctx.textAlign = 'center';
  ctx.fillText('start', c.x, c.y + 26);
}

function drawPendingPlatform(ctx: CanvasRenderingContext2D, d: DrawPlatformDrag): void {
  const a = toScreen(Math.min(d.x0, d.x1), Math.min(d.z0, d.z1));
  const b = toScreen(Math.max(d.x0, d.x1), Math.max(d.z0, d.z1));
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.strokeStyle = '#ffffff';
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 2;
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.setLineDash([]);
}

function strokeSelectable(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  selected: boolean
): void {
  ctx.strokeStyle = selected ? '#ffffff' : 'rgba(20,12,30,0.6)';
  ctx.lineWidth = selected ? 3 : 1;
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
}

// ---------- Canvas: interaction ----------

interface DrawPlatformDrag {
  kind: 'draw-platform';
  /** Both are drawn by dragging a rectangle; this says which one lands. */
  extender: boolean;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
type Drag =
  | DrawPlatformDrag
  | { kind: 'pan'; sx: number; sy: number; ox: number; oz: number }
  | { kind: 'move'; target: Selection; dx: number; dz: number }
  | null;

let drag: Drag = null;

function attachCanvasEvents(): void {
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', onCanvasDown);
  window.addEventListener('mousemove', onCanvasMove);
  window.addEventListener('mouseup', onCanvasUp);
  canvas.addEventListener('wheel', onCanvasWheel, { passive: false });
}

function onCanvasDown(e: MouseEvent): void {
  const rect = canvas.getBoundingClientRect();
  const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);

  if (e.button === 2 || e.button === 1) {
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oz: view.oz };
    return;
  }
  if (e.button !== 0) return;

  switch (tool) {
    case 'platform':
    case 'extender':
      drag = {
        kind: 'draw-platform',
        extender: tool === 'extender',
        x0: snap(w.x),
        z0: snap(w.z),
        x1: snap(w.x),
        z1: snap(w.z),
      };
      break;
    case 'crate':
      addCrate(snap(w.x), snap(w.z));
      break;
    case 'generator':
      addGenerator(snap(w.x), snap(w.z));
      break;
    case 'spawn':
      level().terrain!.spawn = { x: snap(w.x), z: snap(w.z) };
      changed();
      break;
    case 'erase': {
      const hit = hitTest(w.x, w.z);
      if (hit) {
        selection = hit;
        deleteSelection();
      }
      break;
    }
    case 'select': {
      const hit = hitTest(w.x, w.z);
      selection = hit;
      if (hit) {
        const p = positionOf(hit);
        drag = { kind: 'move', target: hit, dx: p.x - w.x, dz: p.z - w.z };
      }
      buildPanel();
      drawCanvas();
      break;
    }
  }
}

function onCanvasMove(e: MouseEvent): void {
  if (!drag) return;
  if (drag.kind === 'pan') {
    view.ox = drag.ox - (e.clientX - drag.sx) / view.scale;
    view.oz = drag.oz - (e.clientY - drag.sy) / view.scale;
    drawCanvas();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);
  if (drag.kind === 'draw-platform') {
    drag.x1 = snap(w.x);
    drag.z1 = snap(w.z);
    drawCanvas();
    return;
  }
  if (drag.kind === 'move' && drag.target) {
    setPosition(drag.target, snap(w.x + drag.dx), snap(w.z + drag.dz));
    changed(false);
  }
}

function onCanvasUp(): void {
  if (drag?.kind === 'draw-platform') {
    const w = Math.abs(drag.x1 - drag.x0);
    const d = Math.abs(drag.z1 - drag.z0);
    const cx = (drag.x0 + drag.x1) / 2;
    const cz = (drag.z0 + drag.z1) / 2;
    // A click without a drag still makes a usable platform.
    if (drag.extender) addExtender(cx, cz, Math.max(2, w), Math.max(2, d));
    else addPlatform(cx, cz, Math.max(2, w), Math.max(2, d));
  } else if (drag?.kind === 'move') {
    buildPanel();
  }
  drag = null;
}

function onCanvasWheel(e: WheelEvent): void {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const before = toWorld(e.clientX - rect.left, e.clientY - rect.top);
  view.scale = Math.min(48, Math.max(4, view.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
  const after = toWorld(e.clientX - rect.left, e.clientY - rect.top);
  // Keep the world point under the cursor pinned while zooming.
  view.ox += before.x - after.x;
  view.oz += before.z - after.z;
  drawCanvas();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelection();
  }
}

/** Topmost thing at this world point: generators, then crates, then platforms. */
function hitTest(x: number, z: number): Selection {
  const lv = level();
  for (const g of [...lv.generators].reverse()) {
    const at = g.at;
    if (at && Math.hypot(x - at.x, z - at.z) <= 1.5) return { kind: 'generator', id: g.id };
  }
  for (const b of [...(lv.terrain?.boxes ?? [])].reverse()) {
    if (Math.abs(x - b.x) <= BOX_SIZE / 2 && Math.abs(z - b.z) <= BOX_SIZE / 2) return { kind: 'crate', id: b.id };
  }
  // Extending platforms float, so they sit above any stone they overlap. Only
  // the slab is grabbable — the arm is drawn where it will be, not where it is.
  for (const e of [...(lv.terrain?.extenders ?? [])].reverse()) {
    if (Math.abs(x - e.x) <= e.w / 2 && Math.abs(z - e.z) <= e.d / 2) return { kind: 'extender', id: e.id };
  }
  // Highest platform wins, matching what you'd be standing on.
  const platforms = [...(lv.terrain?.platforms ?? [])].sort((a, b) => b.y - a.y);
  for (const p of platforms) {
    if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) return { kind: 'platform', id: p.id };
  }
  return null;
}

function positionOf(sel: NonNullable<Selection>): { x: number; z: number } {
  const lv = level();
  if (sel.kind === 'platform') {
    const p = lv.terrain!.platforms.find((q) => q.id === sel.id)!;
    return { x: p.x, z: p.z };
  }
  if (sel.kind === 'extender') {
    const e = extendersOf(lv).find((q) => q.id === sel.id)!;
    return { x: e.x, z: e.z };
  }
  if (sel.kind === 'crate') {
    const b = lv.terrain!.boxes.find((q) => q.id === sel.id)!;
    return { x: b.x, z: b.z };
  }
  const g = lv.generators.find((q) => q.id === sel.id)!;
  return { x: g.at!.x, z: g.at!.z };
}

function setPosition(sel: NonNullable<Selection>, x: number, z: number): void {
  const lv = level();
  if (sel.kind === 'platform') {
    const p = lv.terrain!.platforms.find((q) => q.id === sel.id)!;
    p.x = x;
    p.z = z;
  } else if (sel.kind === 'extender') {
    const e = extendersOf(lv).find((q) => q.id === sel.id)!;
    e.x = x;
    e.z = z;
  } else if (sel.kind === 'crate') {
    const b = lv.terrain!.boxes.find((q) => q.id === sel.id)!;
    b.x = x;
    b.z = z;
  } else {
    const g = lv.generators.find((q) => q.id === sel.id)!;
    g.at!.x = x;
    g.at!.z = z;
  }
}

// ---------- Mutations ----------

function nextId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

function terrainIds(): string[] {
  const t = level().terrain!;
  return [
    ...t.platforms.map((p) => p.id),
    ...t.boxes.map((b) => b.id),
    ...extendersOf(level()).map((e) => e.id),
  ];
}

function addPlatform(x: number, z: number, w: number, d: number): void {
  const p: PlatformDef = {
    id: nextId('p', terrainIds()),
    x: snap(x),
    z: snap(z),
    w: snap(w),
    d: snap(d),
    y: newHeight,
  };
  level().terrain!.platforms.push(p);
  selection = { kind: 'platform', id: p.id };
  changed();
}

function addExtender(x: number, z: number, w: number, d: number): void {
  const lv = level();
  const e: ExtendingPlatformDef = {
    id: nextId('e', terrainIds()),
    x: snap(x),
    z: snap(z),
    w: snap(w),
    d: snap(d),
    y: newHeight,
    dir: newDir,
    length: newLength,
    // Start from a count the level can actually reach, so a freshly placed
    // platform is never born failing the "can this ever appear?" check.
    when: { color: colorsOf(lv)[0] ?? 'red', side: 'day', count: startingCount(lv, colorsOf(lv)[0] ?? 'red', 'day') },
  };
  extendersOf(lv).push(e);
  selection = { kind: 'extender', id: e.id };
  changed();
}

/** What a color/side starts at — the lowest count an extender can ever wait for. */
function startingCount(lv: LevelDef, color: CrystalColor, side: Side): number {
  return lv.initial[color]?.[side] ?? 0;
}

function addCrate(x: number, z: number): void {
  const lv = level();
  const b: BoxDef = { id: nextId('b', terrainIds()), x, z, y: surfaceUnder(lv, x, z) };
  lv.terrain!.boxes.push(b);
  selection = { kind: 'crate', id: b.id };
  changed();
}

function addGenerator(x: number, z: number): void {
  const lv = level();
  const id = nextId(newSide === 'day' ? 'd' : 'n', lv.generators.map((g) => g.id));
  const g: GeneratorDef = {
    id,
    side: newSide,
    outputs: [{ color: colorsOf(lv)[0] ?? 'red', count: 1 }],
    at: { x, y: surfaceUnder(lv, x, z), z },
  };
  lv.generators.push(g);
  lv.solution[id] = 0;
  selection = { kind: 'generator', id };
  changed();
}

function deleteSelection(): void {
  if (!selection) return;
  const lv = level();
  if (selection.kind === 'platform') {
    lv.terrain!.platforms = lv.terrain!.platforms.filter((p) => p.id !== selection!.id);
  } else if (selection.kind === 'extender') {
    lv.terrain!.extenders = extendersOf(lv).filter((e) => e.id !== selection!.id);
  } else if (selection.kind === 'crate') {
    lv.terrain!.boxes = lv.terrain!.boxes.filter((b) => b.id !== selection!.id);
  } else {
    lv.generators = lv.generators.filter((g) => g.id !== selection!.id);
    delete lv.solution[selection.id];
  }
  selection = null;
  changed();
}

function colorsOf(lv: LevelDef): CrystalColor[] {
  const colors = new Set<CrystalColor>(Object.keys(lv.initial) as CrystalColor[]);
  for (const g of lv.generators) for (const o of g.outputs) colors.add(o.color);
  return [...colors];
}

function outputText(g: GeneratorDef): string {
  return g.outputs.map((o) => `+${o.count} ${o.color}`).join(', ') || '(nothing)';
}

// ---------- Panel ----------

function buildPanel(): void {
  panel.replaceChildren(
    el('h2', { className: 'editor-title', text: '🛠 Level Editor' }),
    sectionPack(),
    sectionTools(),
    sectionLevelMeta(),
    sectionCrystals(),
    sectionSelection(),
    sectionGenerators(),
    sectionActions()
  );
}

function section(title: string, children: HTMLElement[]): HTMLElement {
  return el('section', { className: 'editor-section' }, [el('h3', { text: title }), ...children]);
}

function row(children: (HTMLElement | string)[]): HTMLElement {
  return el('div', { className: 'editor-row' }, children);
}

function textInput(value: string, onChange: (v: string) => void, placeholder = ''): HTMLInputElement {
  const input = el('input', { className: 'editor-input' });
  input.value = value;
  input.placeholder = placeholder;
  // Commit on `change` (blur / Enter) so the panel is never rebuilt mid-keystroke.
  input.addEventListener('change', () => onChange(input.value));
  return input;
}

function numInput(value: number, onChange: (v: number) => void, step = 1, min?: number): HTMLInputElement {
  const input = el('input', { className: 'editor-input num' });
  input.type = 'number';
  input.step = String(step);
  if (min !== undefined) input.min = String(min);
  input.value = String(value);
  input.addEventListener('change', () => {
    const n = Number(input.value);
    if (Number.isFinite(n)) onChange(n);
  });
  return input;
}

function labeled(label: string, control: HTMLElement): HTMLElement {
  return el('label', { className: 'editor-field' }, [el('span', { text: label }), control]);
}

function select<T extends string>(options: T[], value: T, onChange: (v: T) => void, labels?: (v: T) => string) {
  const sel = el('select', { className: 'editor-input' });
  for (const o of options) {
    const opt = el('option', { text: labels ? labels(o) : o });
    opt.value = o;
    sel.append(opt);
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value as T));
  return sel;
}

function sectionPack(): HTMLElement {
  const chips = el('div', { className: 'editor-chips' });
  pack.levels.forEach((lv, i) => {
    const chip = button(
      `${lv.index}. ${lv.name}`,
      () => {
        currentIndex = i;
        selection = null;
        save();
        buildPanel();
        drawCanvas();
        refreshStatus();
      },
      i === currentIndex ? 'editor-chip active' : 'editor-chip'
    );
    chips.append(chip);
  });

  return section('Pack', [
    labeled('Pack name', textInput(pack.name, (v) => { pack.name = v; save(); })),
    labeled('Pack id', textInput(pack.id, (v) => { pack.id = v.trim() || 'my-pack'; save(); })),
    labeled('Description', textInput(pack.description, (v) => { pack.description = v; save(); })),
    chips,
    row([
      button('+ Level', () => {
        pack.levels.push(blankLevel(pack.levels.length + 1));
        currentIndex = pack.levels.length - 1;
        selection = null;
        changed();
      }, 'editor-btn'),
      button('Duplicate', () => {
        const copy = structuredClone(level());
        copy.index = pack.levels.length + 1;
        copy.name = `${copy.name} copy`;
        pack.levels.push(copy);
        currentIndex = pack.levels.length - 1;
        changed();
      }, 'editor-btn'),
      button('Delete level', () => {
        if (pack.levels.length === 1) return status('A pack needs at least one level.', true);
        pack.levels.splice(currentIndex, 1);
        pack.levels.forEach((lv, i) => (lv.index = i + 1));
        currentIndex = Math.max(0, currentIndex - 1);
        selection = null;
        changed();
      }, 'editor-btn danger'),
    ]),
  ]);
}

function sectionTools(): HTMLElement {
  const tools: [Tool, string][] = [
    ['select', '↖ Select'],
    ['platform', '▭ Platform'],
    ['extender', '⇥ Extender'],
    ['crate', '📦 Crate'],
    ['generator', '💎 Generator'],
    ['spawn', '⚑ Start'],
    ['erase', '🗑 Erase'],
  ];
  const buttons = el('div', { className: 'editor-tools' });
  for (const [id, label] of tools) {
    buttons.append(
      button(label, () => {
        tool = id;
        buildPanel();
      }, tool === id ? 'editor-tool active' : 'editor-tool')
    );
  }
  const options: HTMLElement[] = [
    labeled('New platform height', numInput(newHeight, (v) => { newHeight = Math.max(1, v); }, 1, 1)),
    labeled('New generator side', select<Side>(['day', 'night'], newSide, (v) => { newSide = v; })),
  ];
  if (tool === 'extender') {
    options.push(
      labeled('Extends', select(ALL_DIRECTIONS, newDir, (v) => { newDir = v; }, (v) => DIRECTION_LABEL[v])),
      labeled('Reach', numInput(newLength, (v) => { newLength = Math.max(1, v); }, 1, 1))
    );
  }

  return section('Tools', [
    buttons,
    ...options,
    el('div', {
      className: 'editor-note',
      text:
        tool === 'platform'
          ? 'Drag a rectangle to draw a platform at the height above.'
          : tool === 'extender'
            ? 'Drag a rectangle to draw a white platform. It floats there and reaches out only while its count matches — set the count below.'
          : tool === 'crate'
            ? 'Click to drop a crate. It lands on whatever is underneath.'
            : tool === 'generator'
              ? 'Click to place a generator, then set its outputs below.'
              : tool === 'spawn'
                ? 'Click to move where the players start.'
                : tool === 'erase'
                  ? 'Click anything to remove it.'
                  : 'Click to select; drag to move. Delete removes it.',
    }),
  ]);
}

function sectionLevelMeta(): HTMLElement {
  const lv = level();
  const cycleValue: 'sunset' | 'night-first' | 'day-first' = !lv.cycle
    ? 'sunset'
    : lv.cycle[0] === 'night'
      ? 'night-first'
      : 'day-first';
  const spawn = lv.terrain?.spawn ?? { x: 0, z: 28 };

  return section('Level', [
    labeled('Name', textInput(lv.name, (v) => { lv.name = v; changed(); })),
    labeled('Concept', textInput(lv.concept, (v) => { lv.concept = v; save(); })),
    labeled('Intro text', textInput(lv.intro ?? '', (v) => { lv.intro = v || undefined; save(); }, 'Shown when the level starts')),
    labeled(
      'Turn style',
      select(['sunset', 'night-first', 'day-first'] as const, cycleValue, (v) => {
        lv.cycle = v === 'sunset' ? undefined : v === 'night-first' ? ['night', 'day'] : ['day', 'night'];
        changed();
      }, (v) => (v === 'sunset' ? 'Sunset (both free)' : v === 'night-first' ? 'Cycle — Night first' : 'Cycle — Day first'))
    ),
    row([
      labeled('Start x', numInput(spawn.x, (v) => { lv.terrain!.spawn = { x: v, z: lv.terrain!.spawn?.z ?? 28 }; changed(); })),
      labeled('Start z', numInput(spawn.z, (v) => { lv.terrain!.spawn = { x: lv.terrain!.spawn?.x ?? 0, z: v }; changed(); })),
    ]),
  ]);
}

function sectionCrystals(): HTMLElement {
  const lv = level();
  const rows: HTMLElement[] = [];
  for (const color of Object.keys(lv.initial) as CrystalColor[]) {
    const c = lv.initial[color]!;
    const swatch = el('span', { className: 'editor-swatch' });
    swatch.style.background = COLOR_HEX[color].ui;
    rows.push(
      row([
        swatch,
        el('span', { className: 'editor-colorname', text: color }),
        labeled('☀', numInput(c.day, (v) => { c.day = Math.max(0, v); changed(); }, 1, 0)),
        labeled('🌙', numInput(c.night, (v) => { c.night = Math.max(0, v); changed(); }, 1, 0)),
        button('✕', () => {
          delete lv.initial[color];
          changed();
        }, 'editor-btn danger tiny'),
      ])
    );
  }
  const unused = ALL_COLORS.filter((c) => !(c in lv.initial));
  if (unused.length > 0) {
    rows.push(
      row([
        button(`+ Add ${unused[0]}`, () => {
          lv.initial[unused[0]] = { day: 0, night: 0 };
          changed();
        }, 'editor-btn'),
      ])
    );
  }
  return section('Starting crystals', rows);
}

function sectionSelection(): HTMLElement {
  if (!selection) return section('Selected', [el('div', { className: 'editor-note', text: 'Nothing selected.' })]);
  const lv = level();

  if (selection.kind === 'platform') {
    const p = lv.terrain!.platforms.find((q) => q.id === selection!.id);
    if (!p) return section('Selected', []);
    return section(`Platform ${p.id}`, [
      row([
        labeled('x', numInput(p.x, (v) => { p.x = v; changed(); })),
        labeled('z', numInput(p.z, (v) => { p.z = v; changed(); })),
      ]),
      row([
        labeled('width', numInput(p.w, (v) => { p.w = Math.max(1, v); changed(); }, 1, 1)),
        labeled('depth', numInput(p.d, (v) => { p.d = Math.max(1, v); changed(); }, 1, 1)),
      ]),
      labeled('height', numInput(p.y, (v) => { p.y = Math.max(1, v); changed(); }, 1, 1)),
      el('div', {
        className: 'editor-note',
        text: 'A jump clears about 2.4 units, so a step of 2 is reachable and 4 needs a crate.',
      }),
      button('Delete', deleteSelection, 'editor-btn danger'),
    ]);
  }

  if (selection.kind === 'extender') {
    const e = extendersOf(lv).find((q) => q.id === selection!.id);
    if (!e) return section('Selected', []);
    return section(`Extending platform ${e.id}`, [
      row([
        labeled('x', numInput(e.x, (v) => { e.x = v; changed(); })),
        labeled('z', numInput(e.z, (v) => { e.z = v; changed(); })),
      ]),
      row([
        labeled('width', numInput(e.w, (v) => { e.w = Math.max(1, v); changed(); }, 1, 1)),
        labeled('depth', numInput(e.d, (v) => { e.d = Math.max(1, v); changed(); }, 1, 1)),
      ]),
      labeled('height', numInput(e.y, (v) => { e.y = Math.max(1, v); changed(); }, 1, 1)),
      labeled('extends', select(ALL_DIRECTIONS, e.dir, (v) => { e.dir = v; changed(); }, (v) => DIRECTION_LABEL[v])),
      labeled('reach', numInput(e.length, (v) => { e.length = Math.max(1, v); changed(); }, 1, 1)),
      el('h4', { text: 'Reaches out while…' }),
      row([
        select(ALL_COLORS, e.when.color, (v) => { e.when.color = v; changed(); }),
        select<Side>(['day', 'night'], e.when.side, (v) => { e.when.side = v; changed(); }),
        numInput(e.when.count, (v) => { e.when.count = Math.max(0, Math.round(v)); changed(); }, 1, 0),
      ]),
      el('div', {
        className: 'editor-note',
        text:
          `Out while ${e.when.side} has exactly ${e.when.count} ${e.when.color}. ` +
          'Counts only grow, so aim for a number the generators can actually land on.',
      }),
      button('Delete', deleteSelection, 'editor-btn danger'),
    ]);
  }

  if (selection.kind === 'crate') {
    const b = lv.terrain!.boxes.find((q) => q.id === selection!.id);
    if (!b) return section('Selected', []);
    return section(`Crate ${b.id}`, [
      row([
        labeled('x', numInput(b.x, (v) => { b.x = v; changed(); })),
        labeled('z', numInput(b.z, (v) => { b.z = v; changed(); })),
      ]),
      el('div', { className: 'editor-note', text: `Rests at height ${b.y}. Crates always sit on what is under them.` }),
      button('Delete', deleteSelection, 'editor-btn danger'),
    ]);
  }

  const g = lv.generators.find((q) => q.id === selection!.id);
  if (!g) return section('Selected', []);
  const outputRows = g.outputs.map((out, i) =>
    row([
      select(ALL_COLORS, out.color, (v) => { out.color = v; changed(); }),
      numInput(out.count, (v) => { out.count = Math.max(1, Math.round(v)); changed(); }, 1, 1),
      button('✕', () => {
        g.outputs.splice(i, 1);
        changed();
      }, 'editor-btn danger tiny'),
    ])
  );
  return section(`Generator ${g.id}`, [
    labeled(
      'id',
      textInput(g.id, (v) => {
        const id = v.trim();
        if (!id || lv.generators.some((q) => q !== g && q.id === id)) return status('That id is already used.', true);
        lv.solution[id] = lv.solution[g.id] ?? 0;
        delete lv.solution[g.id];
        g.id = id;
        selection = { kind: 'generator', id };
        changed();
      })
    ),
    labeled('side', select<Side>(['day', 'night'], g.side, (v) => { g.side = v; changed(); })),
    row([
      labeled('x', numInput(g.at!.x, (v) => { g.at!.x = v; changed(); })),
      labeled('z', numInput(g.at!.z, (v) => { g.at!.z = v; changed(); })),
    ]),
    el('div', { className: 'editor-note', text: `Stands at height ${g.at!.y}.` }),
    el('h4', { text: 'Produces per press' }),
    ...outputRows,
    button('+ Output', () => {
      g.outputs.push({ color: ALL_COLORS[0], count: 1 });
      changed();
    }, 'editor-btn'),
    button('Delete', deleteSelection, 'editor-btn danger'),
  ]);
}

function sectionGenerators(): HTMLElement {
  const lv = level();
  if (lv.generators.length === 0) {
    return section('Solution', [el('div', { className: 'editor-note', text: 'Place some generators first.' })]);
  }
  const rows = lv.generators.map((g) =>
    row([
      button(g.id, () => {
        selection = { kind: 'generator', id: g.id };
        buildPanel();
        drawCanvas();
      }, 'editor-btn tiny'),
      el('span', { className: 'editor-colorname', text: `${g.side} · ${outputText(g)}` }),
      numInput(lv.solution[g.id] ?? 0, (v) => { lv.solution[g.id] = Math.max(0, Math.round(v)); changed(); }, 1, 0),
    ])
  );
  return section('Solution (presses each)', [
    ...rows,
    button('✨ Work out the solution', () => {
      const result = solveLevel(lv);
      if (!result.ok) return status(result.reason, true);
      lv.solution = result.solution;
      changed();
      status(`Solved in ${result.presses} press${result.presses === 1 ? '' : 'es'}.`);
    }, 'editor-btn primary'),
  ]);
}

function sectionActions(): HTMLElement {
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.className = 'editor-file';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) file.text().then(importJson).catch(() => status('Could not read that file.', true));
    fileInput.value = '';
  });

  return section('Finish', [
    button('▶ Play test this level', playTest, 'editor-btn primary'),
    button('✓ Check this level', () => {
      const { errors, warnings } = validateLevel(level());
      if (errors.length === 0 && warnings.length === 0) return status('Looks good — this level is ready.');
      showDialog({
        title: errors.length > 0 ? 'Needs a fix' : 'Looks good, with a note',
        message: [
          ...errors.map((e) => `✗ ${e}`),
          ...warnings.map((w) => `• ${w}`),
        ].join('\n'),
        buttons: [{ label: 'OK', onClick: () => {} }],
      });
    }, 'editor-btn'),
    button('⬇ Download this level (.json)', () => {
      download(`${slug(level().name)}.json`, JSON.stringify(level(), null, 2));
    }, 'editor-btn'),
    button('⬇ Download the whole pack (.json)', () => {
      download(`${slug(pack.id)}-pack.json`, JSON.stringify(pack, null, 2));
    }, 'editor-btn'),
    labeled('Open a .json', fileInput),
    button('← Back to the game', () => {
      window.location.href = '/';
    }, 'editor-btn'),
  ]);
}

// ---------- Actions ----------

function status(message: string, bad = false): void {
  statusLine.textContent = message;
  statusLine.classList.toggle('bad', bad);
}

/** The standing line: how many errors the current level has. */
function refreshStatus(): void {
  const { errors } = validateLevel(level());
  if (errors.length === 0) status(`Level ${level().index} — ready to play.`);
  else status(`Level ${level().index} — ${errors.length} thing${errors.length === 1 ? '' : 's'} to fix: ${errors[0]}`, true);
}

function playTest(): void {
  const lv = structuredClone(level());
  lv.index = 1;
  registerPack({
    id: DRAFT_PACK_ID,
    name: pack.name,
    icon: pack.icon,
    description: 'From the level editor',
    levels: [lv],
  });
  // Step out of the way for the real game, then come back exactly as we were.
  root.remove();
  const game = new GameController(
    new LoopbackChannel(DRAFT_PACK_ID, 1),
    () => {
      clearUI();
      uiRoot().append(root);
      drawCanvas();
    },
    DRAFT_PACK_ID,
    1
  );
  void game;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'level';
}

function download(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  status(`Downloaded ${filename}.`);
}

/** Accepts a whole pack, a bare array of levels, or a single level. */
function importJson(text: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return status('That file is not valid JSON.', true);
  }
  const asPack = parsed as Partial<EditorPack>;
  if (Array.isArray(parsed)) {
    pack = { ...blankPack(), levels: parsed as LevelDef[] };
  } else if (Array.isArray(asPack.levels)) {
    pack = {
      id: asPack.id ?? 'my-pack',
      name: asPack.name ?? 'My Pack',
      icon: asPack.icon ?? '🧗',
      description: asPack.description ?? 'Levels I made',
      levels: asPack.levels,
    };
  } else if ((parsed as LevelDef).generators) {
    pack.levels.push(parsed as LevelDef);
  } else {
    return status('That file does not look like a level or a pack.', true);
  }
  // Imported levels may predate the terrain field; give them somewhere to build.
  for (const lv of pack.levels) {
    lv.terrain ??= { spawn: { x: 0, z: 28 }, platforms: [], boxes: [], extenders: [] };
    lv.terrain.spawn ??= { x: 0, z: 28 };
    lv.terrain.extenders ??= [];
  }
  pack.levels.forEach((lv, i) => (lv.index = i + 1));
  currentIndex = 0;
  selection = null;
  changed();
  status(`Loaded ${pack.levels.length} level${pack.levels.length === 1 ? '' : 's'}.`);
}
