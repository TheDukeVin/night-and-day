// The platformer world model: stone platforms, pushable crates, and extending
// platforms — the physics and collision half, with no rendering in it.
//
// This lives in `shared/` because crates and arms are **game state**, not
// scenery. The authoritative `GameSession` owns a `TerrainSim` and steps it, so
// there is exactly one answer to "where is that crate?" for both players. Each
// client also runs a `TerrainSim` of its own as a *prediction*, so pushing feels
// instant, and corrects it from the session's snapshots (`applySnapshot`).
//
// The model is deliberately blocky and forgiving, which is what makes it
// readable for young players:
//   * A platform is one axis-aligned block, solid from its top face all the way
//     down. You cannot walk under one — you go around, or you jump on top.
//   * A crate is a `BOX_SIZE` cube that slides along ONE world axis at a time
//     and never rotates, so its footprint always lines up with the grid it was
//     authored on.
//   * Anything within `STEP_UP` of your feet is stepped onto for free, so small
//     ledges never snag you.
//   * An extending platform grows an arm along one of six directions while a
//     crystal count matches, and pulls it back in when it stops.

import type { HeightField } from './ground.ts';
import { BOX_SIZE } from './skyway.ts';
import type {
  CrystalCounts,
  ExtendDirection,
  ExtendingPlatformDef,
  LevelTerrain,
} from './types.ts';

export { BOX_SIZE };

/** Ledges this tall or shorter are walked over rather than collided with. */
export const STEP_UP = 0.6;

/** Standing height of a character, for "is this block in my way" tests. */
export const ACTOR_HEIGHT = 2.2;

/**
 * A character's horizontal footprint: half-width when a platform shoves them,
 * and the radius they are slid out of walls with. The session builds a body of
 * this size from each reported pose, so both players take up the same room in
 * the model that they do on screen.
 */
export const PLAYER_RADIUS = 0.5;

/** Crates fall at the same rate the player does, so pushing one off reads right. */
const BOX_GRAVITY = 24;

/** Thickness of an extending platform's slab — thin, so you can walk under it. */
export const EXT_THICKNESS = 0.5;

/**
 * How fast an arm reaches out and pulls back, in world units per second. Slow
 * enough to watch happen, and — being well under `STEP_UP` per frame — slow
 * enough that a rising pillar carries whoever is standing on it up with it.
 */
export const EXT_RATE = 8;

/** Touching is not shoving: overlaps are measured with a hair of slack. */
const PUSH_EPS = 1e-3;

/** Below this, a crate is where the session says it is and nothing "moved". */
const MOVE_EPS = 1e-4;

/** An actor's footprint, as an extending platform sees it. */
export interface PushBox {
  /** Centre of the footprint. */
  x: number;
  z: number;
  /** Height of the underside. */
  feetY: number;
  /** Half-width of the footprint. Every shove runs along one world axis, so a
   * square is exact for a crate and close enough for the player. */
  half: number;
  height: number;
}

/**
 * A character an arm has to reckon with. `shove` is how a growing arm carries
 * one along — present on the client, where the body is ours to move, and absent
 * in the session, where a body is only *reported* by its owner and so is
 * read-only. Either way the body is in the way, which is what decides `stuck`.
 */
export interface TerrainBody {
  pushBox(): PushBox;
  shove?(dx: number, dy: number, dz: number): void;
}

/** One crate's live state. */
export interface CrateState {
  id: string;
  x: number;
  y: number;
  z: number;
  vy: number;
}

/** One extending platform's live state. `reach` eases toward its target length. */
export interface ExtenderState {
  id: string;
  /** Current arm length, 0 = fully retracted. */
  reach: number;
  /** Whether the crystal count currently matches. */
  wanted: boolean;
  /** Held still because growing would crush someone (see `shovesFor`). */
  stuck: boolean;
}

/** Everything about a level's terrain that changes as it is played. */
export interface TerrainSnapshot {
  crates: { id: string; x: number; y: number; z: number }[];
  extenders: { id: string; reach: number }[];
}

/** A push a player made on a crate: one axis, relative to wherever it was. */
export interface CratePush {
  id: string;
  dx: number;
  dz: number;
}

/** An axis-aligned solid, used for both platforms and crates. */
export interface Slab {
  cx: number;
  cz: number;
  hw: number; // half-size along x
  hd: number; // half-size along z
  top: number;
  bottom: number;
  crate: CrateState | null; // set for crates, which can be pushed
}

/** A shove along one world axis; the other two components are always 0. */
interface Shove {
  dx: number;
  dy: number;
  dz: number;
}

export class TerrainSim {
  readonly crates: CrateState[] = [];
  readonly extenders: ExtenderState[] = [];
  /** Platform slabs never change, so they are built once and reused per frame. */
  private platformSlabs: Slab[] = [];
  private extenderDefs = new Map<string, ExtendingPlatformDef>();
  /** Whether the level came with a `terrain` block — see `isPlatformer`. */
  private authored = false;
  /** The characters an arm has to reckon with, by owner (role, or 'local'). */
  private bodies = new Map<string, TerrainBody>();
  /** Pushes made here since `takePushes`, for a client to report upstream. */
  private pushes = new Map<string, CratePush>();

  constructor(
    private def: LevelTerrain | null | undefined,
    private heightAt: HeightField
  ) {
    if (!def) return;
    this.authored = true;
    for (const p of def.platforms) {
      this.platformSlabs.push({
        cx: p.x,
        cz: p.z,
        hw: p.w / 2,
        hd: p.d / 2,
        top: p.y,
        bottom: p.y - PLATFORM_DEPTH,
        crate: null,
      });
    }
    for (const b of def.boxes) this.crates.push({ id: b.id, x: b.x, y: b.y, z: b.z, vy: 0 });
    for (const e of def.extenders ?? []) {
      this.extenderDefs.set(e.id, e);
      this.extenders.push({ id: e.id, reach: 0, wanted: false, stuck: false });
    }
  }

  /**
   * Whether this level authored a `terrain` block at all — that is, whether it is
   * a platformer level. It stays true for a level whose terrain is *empty*: the
   * block is what says "play this one by the platformer's rules" (start on the
   * spawn mark, use generators with your feet), and a pack shouldn't switch
   * control schemes just because one of its levels has nothing built on it yet.
   */
  get isPlatformer(): boolean {
    return this.authored;
  }

  /** Does this level have any extending platforms (drives the first-time tip)? */
  get hasExtenders(): boolean {
    return this.extenders.length > 0;
  }

  /** Is there anything here that has to be simulated at all? */
  get isLive(): boolean {
    return this.crates.length > 0 || this.extenders.length > 0;
  }

  // ---------- Bodies ----------

  /**
   * Register (or clear) a character an arm must reckon with. The client sets its
   * own player; the session sets both players from their reported poses.
   */
  setBody(key: string, body: TerrainBody | null): void {
    if (body) this.bodies.set(key, body);
    else this.bodies.delete(key);
  }

  // ---------- Queries ----------

  /**
   * Every solid right now: static platforms, wherever the crates ended up, and
   * each extending platform's slab plus however far its arm currently reaches.
   */
  private slabs(exclude?: ExtenderState): Slab[] {
    const out = this.platformSlabs.slice();
    for (const e of this.extenders) {
      if (e === exclude) continue;
      const def = this.extenderDefs.get(e.id)!;
      out.push({
        cx: def.x,
        cz: def.z,
        hw: def.w / 2,
        hd: def.d / 2,
        top: def.y,
        bottom: def.y - EXT_THICKNESS,
        crate: null,
      });
      const arm = armSlab(def, e.reach);
      if (arm) out.push(arm);
    }
    for (const c of this.crates) {
      out.push({
        cx: c.x,
        cz: c.z,
        hw: BOX_SIZE / 2,
        hd: BOX_SIZE / 2,
        top: c.y + BOX_SIZE,
        bottom: c.y,
        crate: c,
      });
    }
    return out;
  }

  /**
   * The surface an actor at (x, z) with feet at `feetY` is standing on: the
   * highest top face at or below `feetY + STEP_UP`, falling back to the terrain.
   * `ignore` skips a crate testing its own support.
   */
  supportAt(x: number, z: number, feetY: number, ignore?: CrateState): number {
    let best = this.heightAt(x, z);
    const ceiling = feetY + STEP_UP;
    for (const s of this.slabs()) {
      if (s.crate && s.crate === ignore) continue;
      if (Math.abs(x - s.cx) > s.hw || Math.abs(z - s.cz) > s.hd) continue;
      if (s.top <= ceiling && s.top > best) best = s.top;
    }
    return best;
  }

  /**
   * Slide an actor out of any solid whose side is in its way. When `push` is on,
   * a crate is shoved along the collision axis instead — that is the whole
   * mechanic, and it is why the shove is resolved on a single axis: the crate
   * keeps its authored orientation and only ever changes position.
   *
   * Mutates `pos` in place. Only a client calls this (for its own body); the
   * crate moves it makes are collected by `takePushes` and reported upstream.
   */
  resolve(pos: { x: number; z: number }, radius: number, feetY: number, push: boolean): void {
    const headY = feetY + ACTOR_HEIGHT;
    for (const s of this.slabs()) {
      // Low enough to step onto, or entirely above our head: not in the way.
      if (s.top <= feetY + STEP_UP || s.bottom >= headY) continue;
      const dx = pos.x - s.cx;
      const dz = pos.z - s.cz;
      const penX = s.hw + radius - Math.abs(dx);
      const penZ = s.hd + radius - Math.abs(dz);
      if (penX <= 0 || penZ <= 0) continue;

      // Least-penetration axis: the direction we most recently came from.
      const alongX = penX < penZ;
      const sign = alongX ? Math.sign(dx) || 1 : Math.sign(dz) || 1;
      const amount = alongX ? penX : penZ;

      if (push && s.crate && this.pushCrate(s.crate.id, alongX ? 'x' : 'z', -sign * amount)) continue;
      if (alongX) pos.x = s.cx + sign * (s.hw + radius);
      else pos.z = s.cz + sign * (s.hd + radius);
    }
  }

  /**
   * Slide a crate by `delta` along one axis. The move is rejected wholesale if
   * the crate would end up inside another solid, so a crate can never be squeezed
   * into a wall or another crate — it simply stops and blocks the player.
   *
   * This is the one place a *player* moves a crate, on the client where the push
   * happens and again in the session when the push is reported, so both run the
   * same test against their own view of the level.
   */
  pushCrate(id: string, axis: 'x' | 'z', delta: number): boolean {
    const crate = this.crates.find((c) => c.id === id);
    if (!crate) return false;
    if (delta === 0) return true;
    const nx = axis === 'x' ? crate.x + delta : crate.x;
    const nz = axis === 'z' ? crate.z + delta : crate.z;
    const half = BOX_SIZE / 2;
    for (const s of this.slabs()) {
      if (s.crate === crate) continue;
      // Overlapping vertically? A slab whose top is at or below the crate's base
      // is floor, not wall.
      if (s.top <= crate.y + STEP_UP || s.bottom >= crate.y + BOX_SIZE) continue;
      if (Math.abs(nx - s.cx) < s.hw + half && Math.abs(nz - s.cz) < s.hd + half) return false;
    }
    crate.x = nx;
    crate.z = nz;
    const pending = this.pushes.get(id) ?? { id, dx: 0, dz: 0 };
    if (axis === 'x') pending.dx += delta;
    else pending.dz += delta;
    this.pushes.set(id, pending);
    return true;
  }

  /**
   * Pushes made here since the last call, for a client to send to the session.
   * They are *deltas*, so the session applies them from its own crate positions
   * and a client's prediction error never leaks into the authoritative state.
   */
  takePushes(): CratePush[] | null {
    if (this.pushes.size === 0) return null;
    const out = [...this.pushes.values()];
    this.pushes.clear();
    return out;
  }

  /** Apply a push reported by a player (the session side of `takePushes`). */
  applyPushes(pushes: CratePush[]): void {
    for (const p of pushes) {
      if (p.dx) this.pushCrate(p.id, 'x', p.dx);
      if (p.dz) this.pushCrate(p.id, 'z', p.dz);
    }
    // A reported push is input, not something to report onward again.
    this.pushes.clear();
  }

  // ---------- Extending platforms ----------

  /** Everything a growing arm might shove this frame: the bodies and the crates. */
  private pushables(): TerrainBody[] {
    const out: TerrainBody[] = [...this.bodies.values()];
    for (const c of this.crates) out.push(this.crateAsBody(c));
    return out;
  }

  private crateAsBody(crate: CrateState): TerrainBody & { crate: CrateState } {
    return {
      crate,
      pushBox: () => ({ x: crate.x, z: crate.z, feetY: crate.y, half: BOX_SIZE / 2, height: BOX_SIZE }),
      shove: (dx, dy, dz) => {
        crate.x += dx;
        crate.y += dy;
        crate.z += dz;
        // A crate shoved up or down is no longer falling at its old speed.
        if (dy !== 0) crate.vy = 0;
      },
    };
  }

  /**
   * The shoves an arm growing out to `next` would deal, or **null** if any of
   * them is impossible — the actor is wedged between this platform and something
   * that isn't moving. A null answer holds the whole platform still (rather than
   * squeezing anyone through a wall), and it keeps being null until whoever is
   * caught walks — or is pushed — clear.
   *
   * Only growth shoves: retracting takes the surfaces away from everyone.
   */
  private shovesFor(e: ExtenderState, next: number): (() => void)[] | null {
    const def = this.extenderDefs.get(e.id)!;
    const arm = armSlab(def, next);
    if (!arm) return [];
    const moves: (() => void)[] = [];
    for (const actor of this.pushables()) {
      const a = actor.pushBox();
      if (!inTheWay(a, arm, def.dir)) continue;
      const d = clearanceOf(a, arm, def.dir);
      const own = 'crate' in actor ? (actor as { crate: CrateState }).crate : null;
      if (this.wouldWedge(a, d, e, own)) return null;
      // A body the session only *hears about* has no `shove` — it is moved by
      // the client that owns it. Called on `actor` so a class method keeps its
      // receiver.
      if (actor.shove) moves.push(() => actor.shove!(d.dx, d.dy, d.dz));
    }
    return moves;
  }

  /**
   * Would this actor, shoved by `d`, end up inside something? That is the "two
   * surfaces closing on one body" case: the ground below, a wall it is being
   * swept into, a crate, or another platform's slab.
   */
  private wouldWedge(a: PushBox, d: Shove, moving: ExtenderState, own: CrateState | null): boolean {
    const at: PushBox = { ...a, x: a.x + d.dx, z: a.z + d.dz, feetY: a.feetY + d.dy };
    // Being shoved sideways onto a low ledge or a slope is just walking, so a
    // surface within `STEP_UP` doesn't count. Being shoved DOWN onto one is the
    // squeeze itself, so there the floor gets no slack at all.
    const slack = d.dy < 0 ? 0 : STEP_UP;
    if (at.feetY + slack < this.heightAt(at.x, at.z) - PUSH_EPS) return true; // into the ground
    for (const s of this.slabs(moving)) {
      if (s.crate && s.crate === own) continue;
      // A surface low enough to stand on is floor, and one above our head is
      // ceiling we still fit under: neither is a wedge.
      if (s.top <= at.feetY + slack || s.bottom >= at.feetY + at.height - PUSH_EPS) continue;
      if (Math.abs(at.x - s.cx) < s.hw + at.half - PUSH_EPS && Math.abs(at.z - s.cz) < s.hd + at.half - PUSH_EPS) {
        return true;
      }
    }
    return false;
  }

  /**
   * Point every extending platform at the crystal counts. The counts come from
   * the authoritative state, so both players' arms are aiming at the same target
   * even before a snapshot arrives. Pass `animate` false on a fresh level load,
   * where an already-matching platform should just be out.
   */
  setCounts(counts: CrystalCounts, animate = true): void {
    for (const e of this.extenders) {
      const def = this.extenderDefs.get(e.id)!;
      const have = counts[def.when.color]?.[def.when.side] ?? 0;
      e.wanted = have === def.when.count;
      if (!animate) e.reach = e.wanted ? def.length : 0;
    }
  }

  /** How far an arm is out, for the renderer (0 = retracted, 1 = full). */
  extension(e: ExtenderState): number {
    const def = this.extenderDefs.get(e.id)!;
    return def.length > 0 ? e.reach / def.length : 0;
  }

  /** The arm's solid right now, or null while it is fully retracted. */
  armOf(e: ExtenderState): Slab | null {
    return armSlab(this.extenderDefs.get(e.id)!, e.reach);
  }

  defOf(e: ExtenderState): ExtendingPlatformDef {
    return this.extenderDefs.get(e.id)!;
  }

  // ---------- Per-frame ----------

  /**
   * Advance arms and let unsupported crates fall (pushing one off a ledge drops
   * it to the floor). Returns whether anything actually moved, which is what
   * decides whether the session has news worth sending.
   */
  step(dt: number): boolean {
    let moved = false;
    for (const e of this.extenders) {
      const def = this.extenderDefs.get(e.id)!;
      const target = e.wanted ? def.length : 0;
      const step = EXT_RATE * dt;
      const before = e.reach;
      if (e.reach < target) {
        // Growing: carry anyone in the way along with the arm, unless one of
        // them has nowhere to go — then the platform waits for them.
        const next = Math.min(target, e.reach + step);
        const shoves = this.shovesFor(e, next);
        e.stuck = shoves === null;
        if (shoves) {
          for (const shove of shoves) shove();
          e.reach = next;
        }
      } else {
        e.reach = Math.max(target, e.reach - step);
        e.stuck = false;
      }
      if (Math.abs(e.reach - before) > MOVE_EPS) moved = true;
    }
    for (const c of this.crates) {
      const support = this.supportAt(c.x, c.z, c.y, c);
      if (c.y > support + 1e-3) {
        c.vy -= BOX_GRAVITY * dt;
        c.y += c.vy * dt;
        if (c.y <= support) {
          c.y = support;
          c.vy = 0;
        }
        moved = true;
      } else if (c.y < support) {
        // A crate was pushed onto something taller than a step: sit on it.
        c.y = support;
        c.vy = 0;
        moved = true;
      }
    }
    return moved;
  }

  // ---------- State ----------

  /** Everything a peer (or a fresh level load) needs to agree with this one. */
  snapshot(): TerrainSnapshot {
    return {
      crates: this.crates.map((c) => ({ id: c.id, x: c.x, y: c.y, z: c.z })),
      extenders: this.extenders.map((e) => ({ id: e.id, reach: e.reach })),
    };
  }

  /**
   * Adopt the authoritative state. Crate positions replace whatever this sim
   * predicted; arms are set to the reach the session decided, which is the one
   * that took *both* bodies into account.
   */
  applySnapshot(snap: TerrainSnapshot): void {
    for (const inc of snap.crates) {
      const c = this.crates.find((live) => live.id === inc.id);
      if (!c) continue;
      c.x = inc.x;
      c.y = inc.y;
      c.z = inc.z;
      c.vy = 0;
    }
    for (const inc of snap.extenders) {
      const e = this.extenders.find((live) => live.id === inc.id);
      if (e) e.reach = inc.reach;
    }
  }

  /** Put every crate back where the level author placed it (Reset). */
  restore(): void {
    for (const c of this.crates) {
      const authored = this.def?.boxes.find((b) => b.id === c.id);
      if (!authored) continue;
      c.x = authored.x;
      c.y = authored.y;
      c.z = authored.z;
      c.vy = 0;
    }
    this.pushes.clear();
  }
}

/** How far below its top face a platform's stone block extends. */
const PLATFORM_DEPTH = 14;

/**
 * The arm's solid at `reach`, or null while the platform is fully retracted.
 * Horizontal arms are bridges level with the slab's top; `+y` grows a pillar out
 * of the top face and `-y` one out of the bottom.
 */
export function armSlab(def: ExtendingPlatformDef, reach: number): Slab | null {
  if (reach <= 1e-3) return null;
  const hw = def.w / 2;
  const hd = def.d / 2;
  const bottom = def.y - EXT_THICKNESS;
  const half = reach / 2;
  switch (def.dir) {
    case '+x':
      return { cx: def.x + hw + half, cz: def.z, hw: half, hd, top: def.y, bottom, crate: null };
    case '-x':
      return { cx: def.x - hw - half, cz: def.z, hw: half, hd, top: def.y, bottom, crate: null };
    case '+z':
      return { cx: def.x, cz: def.z + hd + half, hw, hd: half, top: def.y, bottom, crate: null };
    case '-z':
      return { cx: def.x, cz: def.z - hd - half, hw, hd: half, top: def.y, bottom, crate: null };
    case '+y':
      return { cx: def.x, cz: def.z, hw, hd, top: def.y + reach, bottom: def.y, crate: null };
    case '-y':
      return { cx: def.x, cz: def.z, hw, hd, top: bottom, bottom: bottom - reach, crate: null };
  }
}

/**
 * Is this actor in the way of an arm that has grown to `arm`? Horizontal arms
 * follow the same rule as every other wall: one whose top is within `STEP_UP` of
 * the actor's feet slides underneath and is stepped onto instead of shoving. A
 * `+y` pillar is the opposite — its top face rising past the feet is exactly how
 * it carries someone — and a `-y` one comes down as a ceiling.
 */
function inTheWay(a: PushBox, arm: Slab, dir: ExtendDirection): boolean {
  if (Math.abs(a.x - arm.cx) >= arm.hw + a.half - PUSH_EPS) return false;
  if (Math.abs(a.z - arm.cz) >= arm.hd + a.half - PUSH_EPS) return false;
  if (a.feetY >= arm.top - PUSH_EPS || a.feetY + a.height <= arm.bottom + PUSH_EPS) return false;
  return dir === '+y' || dir === '-y' || arm.top > a.feetY + STEP_UP;
}

/** How far, and which way, this actor has to move to be clear of the arm. */
function clearanceOf(a: PushBox, arm: Slab, dir: ExtendDirection): Shove {
  switch (dir) {
    case '+x':
      return { dx: arm.cx + arm.hw + a.half - a.x, dy: 0, dz: 0 };
    case '-x':
      return { dx: arm.cx - arm.hw - a.half - a.x, dy: 0, dz: 0 };
    case '+z':
      return { dx: 0, dy: 0, dz: arm.cz + arm.hd + a.half - a.z };
    case '-z':
      return { dx: 0, dy: 0, dz: arm.cz - arm.hd - a.half - a.z };
    case '+y':
      return { dx: 0, dy: arm.top - a.feetY, dz: 0 }; // carried up on top
    case '-y':
      return { dx: 0, dy: arm.bottom - a.height - a.feetY, dz: 0 }; // pressed down under
  }
}

/**
 * The face the condition marks are set into. A `+y` slab grows a pillar out of
 * that very face, so its marks ride the top of the pillar instead of being
 * swallowed by it; every other direction leaves the slab's own face alone.
 */
export function markTopY(def: ExtendingPlatformDef, reach: number): number {
  return def.dir === '+y' ? def.y + reach : def.y;
}

/** Depth of the stone block under a platform's top face (renderer needs it too). */
export { PLATFORM_DEPTH };
