// Skyway terrain: stone platforms you jump onto and crates you push.
//
// This module owns both halves of the mechanic — the meshes AND the collision
// model — because they have to agree exactly: a crate you can see beside a
// platform must also be a step you can stand on.
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
//   * An extending platform is a white slab that grows an arm along one of the
//     six directions while a crystal count matches, and pulls it back in when it
//     stops. Its state is derived from the counts, never stored — see
//     `setCounts` — so both players always see the same bridge.

import * as THREE from 'three';
import type {
  BoxDef,
  CrystalCounts,
  ExtendDirection,
  ExtendingPlatformDef,
  LevelTerrain,
  PlatformDef,
} from '../../../shared/types.ts';
import { BOX_SIZE } from '../../../shared/skyway.ts';
import { COLOR_HEX } from './crystals.ts';

export { BOX_SIZE };

/** Ledges this tall or shorter are walked over rather than collided with. */
export const STEP_UP = 0.6;

/** How far below its top face a platform's stone block extends. */
const PLATFORM_DEPTH = 14;

/** Standing height of a character, for "is this block in my way" tests. */
export const ACTOR_HEIGHT = 2.2;

/** Crates fall at the same rate the player does, so pushing one off reads right. */
const BOX_GRAVITY = 24;

/** A crate must move at least this far to be worth telling the peer about. */
const BOX_SYNC_EPS = 0.02;

/** Thickness of an extending platform's slab — thin, so you can walk under it. */
const EXT_THICKNESS = 0.5;

/**
 * How fast an arm reaches out and pulls back, in world units per second. Slow
 * enough to watch happen, and — being well under `STEP_UP` per frame — slow
 * enough that a rising pillar carries whoever is standing on it up with it.
 */
const EXT_RATE = 8;

/** Mini diamonds are laid out in rows of five, like the crystal stacks. */
const DIAMONDS_PER_ROW = 5;
const DIAMOND_STEP = 0.5;
const DIAMOND_ROW_STEP = 0.62;

/**
 * A slab authored flush with the ground would z-fight the terrain, so a flush
 * one is drawn a hair proud of it. Purely visual — collision keeps the authored
 * y, and the lift is far under `STEP_UP`.
 */
const FLUSH_LIFT = 0.03;

/** Touching is not shoving: overlaps are measured with a hair of slack. */
const PUSH_EPS = 1e-3;

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

/** Something a growing platform can shove: the player, or a crate. */
export interface Pushable {
  pushBox(): PushBox;
  shove(dx: number, dy: number, dz: number): void;
}

/** One crate's live state; `def` is the authored start, restored on reset. */
interface LiveBox {
  def: BoxDef;
  mesh: THREE.Group;
  x: number;
  y: number;
  z: number;
  vy: number;
}

/** An axis-aligned solid, used for both platforms and crates. */
interface Slab {
  cx: number;
  cz: number;
  hw: number; // half-size along x
  hd: number; // half-size along z
  top: number;
  bottom: number;
  box: LiveBox | null; // set for crates, which can be pushed
}

/** One extending platform's live state. `reach` eases toward its target length. */
interface LiveExtender {
  def: ExtendingPlatformDef;
  group: THREE.Group;
  /** The growing arm: a unit cube, scaled and placed from `reach` every frame. */
  arm: THREE.Mesh;
  /** Slab + arm share this clone so both brighten together when the count matches. */
  mat: THREE.MeshStandardMaterial;
  /** The condition marks, spun gently so they catch the eye from a distance. */
  diamonds: THREE.Object3D[];
  /** Current arm length, 0 = fully retracted. */
  reach: number;
  /** Whether the crystal count currently matches. */
  wanted: boolean;
  /** Held still because growing would crush someone (see `shovesFor`). */
  stuck: boolean;
}

const STONE_MAT = new THREE.MeshStandardMaterial({ color: 0x8d8779, roughness: 0.95, flatShading: true });
const STONE_TOP_MAT = new THREE.MeshStandardMaterial({ color: 0xa8a292, roughness: 0.9, flatShading: true });

/** Crates are warmer and rune-lit so they read as "this one moves". */
const CRATE_MAT = new THREE.MeshStandardMaterial({ color: 0xb59263, roughness: 0.8, flatShading: true });
const CRATE_EDGE_MAT = new THREE.LineBasicMaterial({ color: 0xffe0a8 });
const CRATE_EDGE_GEO = new THREE.EdgesGeometry(new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE));

/** Extending platforms are white, so they never read as ordinary stone. */
const MAGIC_MAT = new THREE.MeshStandardMaterial({
  color: 0xf2f5ff,
  roughness: 0.4,
  emissive: 0xcdd8ff,
  emissiveIntensity: 0.2,
  flatShading: true,
});
const MAGIC_EDGE_MAT = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
/** A unit cube, scaled per frame into the arm. */
const UNIT_BOX_GEO = new THREE.BoxGeometry(1, 1, 1);

/** A condition mark: a little crystal, standing for one of the counted crystals. */
const DIAMOND_GEO = new THREE.OctahedronGeometry(0.17, 0);
DIAMOND_GEO.scale(1, 1.5, 1);
const DIAMOND_EDGE_GEO = new THREE.EdgesGeometry(DIAMOND_GEO);

/**
 * Diamond materials, cached per color+side: a day mark glows like a day crystal,
 * a night mark is dark with a pale rim — the same language the crystal stacks
 * use, so "4 day red" reads the same on a platform as it does on the platform's
 * counter.
 */
const DIAMOND_MATS = new Map<string, THREE.MeshStandardMaterial>();
function diamondMaterial(color: keyof typeof COLOR_HEX, side: 'day' | 'night'): THREE.MeshStandardMaterial {
  const key = `${color}:${side}`;
  const cached = DIAMOND_MATS.get(key);
  if (cached) return cached;
  const hex = COLOR_HEX[color][side];
  const mat = new THREE.MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: side === 'day' ? 0.75 : 0.15,
    roughness: 0.2,
    flatShading: true,
  });
  DIAMOND_MATS.set(key, mat);
  return mat;
}

const DIAMOND_EDGE_MATS = new Map<string, THREE.LineBasicMaterial>();
function diamondEdgeMaterial(color: keyof typeof COLOR_HEX): THREE.LineBasicMaterial {
  const cached = DIAMOND_EDGE_MATS.get(color);
  if (cached) return cached;
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(COLOR_HEX[color].day).lerp(new THREE.Color(0xffffff), 0.5),
  });
  DIAMOND_EDGE_MATS.set(color, mat);
  return mat;
}

export class Terrain {
  readonly group = new THREE.Group();
  private platforms: PlatformDef[] = [];
  private boxes: LiveBox[] = [];
  private extenders: LiveExtender[] = [];
  /** Platform slabs never change, so they are built once and reused per frame. */
  private platformSlabs: Slab[] = [];
  /** Set whenever a crate moves; the controller relays the new spots to the peer. */
  private boxesDirty = false;
  /** The local player, so a growing platform can shove them out of its way. */
  private player: Pushable | null = null;
  /** Whether the level came with a `terrain` block — see `isPlatformer`. */
  private authored = false;

  constructor(
    def: LevelTerrain | null | undefined,
    private heightAt: (x: number, z: number) => number
  ) {
    if (!def) return;
    this.authored = true;
    this.platforms = def.platforms;
    for (const p of def.platforms) {
      this.platformSlabs.push({
        cx: p.x,
        cz: p.z,
        hw: p.w / 2,
        hd: p.d / 2,
        top: p.y,
        bottom: p.y - PLATFORM_DEPTH,
        box: null,
      });
      this.group.add(buildPlatformMesh(p));
    }
    for (const b of def.boxes) {
      const mesh = buildCrateMesh();
      this.group.add(mesh);
      this.boxes.push({ def: b, mesh, x: b.x, y: b.y, z: b.z, vy: 0 });
    }
    for (const e of def.extenders ?? []) {
      const live = buildExtender(e, this.heightAt(e.x, e.z));
      this.group.add(live.group);
      this.extenders.push(live);
    }
    this.syncMeshes();
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

  // ---------- Queries ----------

  /**
   * Every solid right now: static platforms, wherever the crates ended up, and
   * each extending platform's slab plus however far its arm currently reaches.
   */
  private slabs(exclude?: LiveExtender): Slab[] {
    const out = this.platformSlabs.slice();
    for (const e of this.extenders) {
      if (e === exclude) continue;
      out.push({
        cx: e.def.x,
        cz: e.def.z,
        hw: e.def.w / 2,
        hd: e.def.d / 2,
        top: e.def.y,
        bottom: e.def.y - EXT_THICKNESS,
        box: null,
      });
      const arm = armSlab(e.def, e.reach);
      if (arm) out.push(arm);
    }
    for (const b of this.boxes) {
      out.push({
        cx: b.x,
        cz: b.z,
        hw: BOX_SIZE / 2,
        hd: BOX_SIZE / 2,
        top: b.y + BOX_SIZE,
        bottom: b.y,
        box: b,
      });
    }
    return out;
  }

  /**
   * The surface an actor at (x, z) with feet at `feetY` is standing on: the
   * highest top face at or below `feetY + STEP_UP`, falling back to the terrain.
   * `ignore` skips a crate testing its own support.
   */
  supportAt(x: number, z: number, feetY: number, ignore?: LiveBox): number {
    let best = this.heightAt(x, z);
    const ceiling = feetY + STEP_UP;
    for (const s of this.slabs()) {
      if (s.box && s.box === ignore) continue;
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
   * Returns the (possibly nudged) position, mutating `pos` in place.
   */
  resolve(pos: THREE.Vector3, radius: number, feetY: number, push: boolean): void {
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

      if (push && s.box && this.tryPushBox(s.box, alongX ? 'x' : 'z', -sign * amount)) continue;
      if (alongX) pos.x = s.cx + sign * (s.hw + radius);
      else pos.z = s.cz + sign * (s.hd + radius);
    }
  }

  /**
   * Slide `box` by `delta` along one axis. The move is rejected wholesale if the
   * crate would end up inside another solid, so a crate can never be squeezed
   * into a wall or another crate — it simply stops and blocks the player.
   */
  private tryPushBox(box: LiveBox, axis: 'x' | 'z', delta: number): boolean {
    if (delta === 0) return true;
    const nx = axis === 'x' ? box.x + delta : box.x;
    const nz = axis === 'z' ? box.z + delta : box.z;
    const half = BOX_SIZE / 2;
    for (const s of this.slabs()) {
      if (s.box === box) continue;
      // Overlapping vertically? A slab whose top is at or below the crate's base
      // is floor, not wall.
      if (s.top <= box.y + STEP_UP || s.bottom >= box.y + BOX_SIZE) continue;
      if (Math.abs(nx - s.cx) < s.hw + half && Math.abs(nz - s.cz) < s.hd + half) return false;
    }
    box.x = nx;
    box.z = nz;
    this.boxesDirty = true;
    return true;
  }

  // ---------- Extending platforms ----------

  /** Tell the terrain who the local player is, so platforms can shove them. */
  setPlayer(player: Pushable | null): void {
    this.player = player;
  }

  /** Everything a growing arm might shove this frame: the player and the crates. */
  private pushables(): Pushable[] {
    const out: Pushable[] = this.player ? [this.player] : [];
    for (const b of this.boxes) out.push(this.crateAsPushable(b));
    return out;
  }

  private crateAsPushable(box: LiveBox): Pushable & { box: LiveBox } {
    return {
      box,
      pushBox: () => ({ x: box.x, z: box.z, feetY: box.y, half: BOX_SIZE / 2, height: BOX_SIZE }),
      shove: (dx, dy, dz) => {
        box.x += dx;
        box.y += dy;
        box.z += dz;
        // A crate shoved up or down is no longer falling at its old speed.
        if (dy !== 0) box.vy = 0;
        this.boxesDirty = true;
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
  private shovesFor(e: LiveExtender, next: number): (() => void)[] | null {
    const arm = armSlab(e.def, next);
    if (!arm) return [];
    const moves: (() => void)[] = [];
    for (const actor of this.pushables()) {
      const a = actor.pushBox();
      if (!inTheWay(a, arm, e.def.dir)) continue;
      const d = clearanceOf(a, arm, e.def.dir);
      const own = 'box' in actor ? (actor as { box: LiveBox }).box : null;
      if (this.wouldWedge(a, d, e, own)) return null;
      moves.push(() => actor.shove(d.dx, d.dy, d.dz));
    }
    return moves;
  }

  /**
   * Would this actor, shoved by `d`, end up inside something? That is the "two
   * surfaces closing on one body" case: the ground below, a wall it is being
   * swept into, a crate, or another platform's slab.
   */
  private wouldWedge(a: PushBox, d: Shove, moving: LiveExtender, own: LiveBox | null): boolean {
    const at: PushBox = { ...a, x: a.x + d.dx, z: a.z + d.dz, feetY: a.feetY + d.dy };
    // Being shoved sideways onto a low ledge or a slope is just walking, so a
    // surface within `STEP_UP` doesn't count. Being shoved DOWN onto one is the
    // squeeze itself, so there the floor gets no slack at all.
    const slack = d.dy < 0 ? 0 : STEP_UP;
    if (at.feetY + slack < this.heightAt(at.x, at.z) - PUSH_EPS) return true; // into the ground
    for (const s of this.slabs(moving)) {
      if (s.box && s.box === own) continue;
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
   * Point every extending platform at the crystal counts. The counts are derived
   * from the authoritative state, so this is all it takes to keep two players'
   * bridges identical — there is nothing extra to send. Pass `animate` false on a
   * fresh level load, where an already-matching platform should just be out.
   */
  setCounts(counts: CrystalCounts, animate = true): void {
    for (const e of this.extenders) {
      const have = counts[e.def.when.color]?.[e.def.when.side] ?? 0;
      e.wanted = have === e.def.when.count;
      if (!animate) e.reach = e.wanted ? e.def.length : 0;
    }
    this.syncMeshes();
  }

  // ---------- Per-frame ----------

  /** Let unsupported crates fall (pushing one off a ledge drops it to the floor). */
  update(dt: number): void {
    for (const e of this.extenders) {
      const target = e.wanted ? e.def.length : 0;
      const step = EXT_RATE * dt;
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
      // Lit while it is out, so the platform itself answers "is my count right?".
      const out = e.def.length > 0 ? e.reach / e.def.length : 0;
      e.mat.emissiveIntensity = 0.2 + out * 0.55;
      // Waiting on someone: throb, so a platform that stopped early reads as
      // "something is in my way" rather than as broken.
      if (e.stuck) e.mat.emissiveIntensity += 0.3 * (0.5 + 0.5 * Math.sin(performance.now() * 0.008));
      for (const d of e.diamonds) d.rotation.y += dt * 1.1;
    }
    for (const b of this.boxes) {
      const support = this.supportAt(b.x, b.z, b.y, b);
      if (b.y > support + 1e-3) {
        b.vy -= BOX_GRAVITY * dt;
        b.y += b.vy * dt;
        if (b.y <= support) {
          b.y = support;
          b.vy = 0;
        }
        this.boxesDirty = true;
      } else if (b.y < support) {
        // A crate was pushed onto something taller than a step: sit on it.
        b.y = support;
        b.vy = 0;
        this.boxesDirty = true;
      }
    }
    this.syncMeshes();
  }

  private syncMeshes(): void {
    for (const b of this.boxes) b.mesh.position.set(b.x, b.y + BOX_SIZE / 2, b.z);
    for (const e of this.extenders) {
      const topY = markTopY(e.def, e.reach);
      for (const d of e.diamonds) d.position.y = topY;
      const arm = armSlab(e.def, e.reach);
      e.arm.visible = arm !== null;
      if (!arm) continue;
      e.arm.position.set(arm.cx, (arm.top + arm.bottom) / 2, arm.cz);
      e.arm.scale.set(arm.hw * 2, arm.top - arm.bottom, arm.hd * 2);
    }
  }

  // ---------- Networking & reset ----------

  /** Crate positions to relay, or null when nothing has moved since last call. */
  takeMoved(): BoxDef[] | null {
    if (!this.boxesDirty) return null;
    this.boxesDirty = false;
    return this.boxes.map((b) => ({ id: b.def.id, x: b.x, y: b.y, z: b.z }));
  }

  /** Apply crate positions pushed by the other player. */
  applyRemote(boxes: BoxDef[]): void {
    for (const incoming of boxes) {
      const b = this.boxes.find((live) => live.def.id === incoming.id);
      if (!b) continue;
      if (
        Math.abs(b.x - incoming.x) < BOX_SYNC_EPS &&
        Math.abs(b.y - incoming.y) < BOX_SYNC_EPS &&
        Math.abs(b.z - incoming.z) < BOX_SYNC_EPS
      ) {
        continue;
      }
      b.x = incoming.x;
      b.y = incoming.y;
      b.z = incoming.z;
      b.vy = 0;
    }
    this.syncMeshes();
  }

  /** Put every crate back where the level author placed it (Reset). */
  restore(): void {
    for (const b of this.boxes) {
      b.x = b.def.x;
      b.y = b.def.y;
      b.z = b.def.z;
      b.vy = 0;
    }
    this.boxesDirty = this.boxes.length > 0;
    this.syncMeshes();
  }

  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      // Most materials and several geometries are module-level and shared.
      if (mesh.geometry && !SHARED_GEOS.has(mesh.geometry)) mesh.geometry.dispose();
    });
    // Each extending platform owns a clone, so it can light up on its own.
    for (const e of this.extenders) e.mat.dispose();
    this.group.clear();
  }
}

function buildPlatformMesh(p: PlatformDef): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(p.w, PLATFORM_DEPTH, p.d), STONE_MAT);
  body.position.set(p.x, p.y - PLATFORM_DEPTH / 2, p.z);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // A slightly wider, lighter cap: it reads as the standable face from a
  // distance and gives the edge a lip to aim a jump at.
  const cap = new THREE.Mesh(new THREE.BoxGeometry(p.w + 0.5, 0.45, p.d + 0.5), STONE_TOP_MAT);
  cap.position.set(p.x, p.y - 0.15, p.z);
  cap.castShadow = true;
  cap.receiveShadow = true;
  group.add(cap);
  return group;
}

function buildCrateMesh(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE), CRATE_MAT);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  // Glowing edges — the visual promise that this block is the one that moves.
  group.add(new THREE.LineSegments(CRATE_EDGE_GEO, CRATE_EDGE_MAT));
  return group;
}

/** Geometries every level shares; `dispose` must leave these alone. */
const SHARED_GEOS: ReadonlySet<THREE.BufferGeometry> = new Set([
  CRATE_EDGE_GEO,
  UNIT_BOX_GEO,
  DIAMOND_GEO,
  DIAMOND_EDGE_GEO,
]);

/**
 * The arm's solid right now, or null while the platform is fully retracted.
 * Horizontal arms are bridges level with the slab's top; `+y` grows a pillar out
 * of the top face and `-y` one out of the bottom.
 */
function armSlab(def: ExtendingPlatformDef, reach: number): Slab | null {
  if (reach <= 1e-3) return null;
  const hw = def.w / 2;
  const hd = def.d / 2;
  const bottom = def.y - EXT_THICKNESS;
  const half = reach / 2;
  switch (def.dir) {
    case '+x':
      return { cx: def.x + hw + half, cz: def.z, hw: half, hd, top: def.y, bottom, box: null };
    case '-x':
      return { cx: def.x - hw - half, cz: def.z, hw: half, hd, top: def.y, bottom, box: null };
    case '+z':
      return { cx: def.x, cz: def.z + hd + half, hw, hd: half, top: def.y, bottom, box: null };
    case '-z':
      return { cx: def.x, cz: def.z - hd - half, hw, hd: half, top: def.y, bottom, box: null };
    case '+y':
      return { cx: def.x, cz: def.z, hw, hd, top: def.y + reach, bottom: def.y, box: null };
    case '-y':
      return { cx: def.x, cz: def.z, hw, hd, top: bottom, bottom: bottom - reach, box: null };
  }
}

/** A shove along one world axis; the other two components are always 0. */
interface Shove {
  dx: number;
  dy: number;
  dz: number;
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
function markTopY(def: ExtendingPlatformDef, reach: number): number {
  return def.dir === '+y' ? def.y + reach : def.y;
}

/**
 * Where the `n`th of `total` condition marks sits, relative to the slab's top
 * center: rows of five, so a count reads as "a full hand and two more" rather
 * than as a line the eye has to count one by one. Each row is centered on its
 * own, and the block of rows is centered as a whole.
 */
function diamondOffset(index: number, total: number): { dx: number; dz: number } {
  const rows = Math.ceil(total / DIAMONDS_PER_ROW);
  const row = Math.floor(index / DIAMONDS_PER_ROW);
  const inRow = index % DIAMONDS_PER_ROW;
  const rowCount = Math.min(DIAMONDS_PER_ROW, total - row * DIAMONDS_PER_ROW);
  return {
    dx: (inRow - (rowCount - 1) / 2) * DIAMOND_STEP,
    dz: (row - (rows - 1) / 2) * DIAMOND_ROW_STEP,
  };
}

/**
 * A white slab with one mini crystal per crystal the condition asks for, set
 * into its top face — a level's whole "when does this appear?" rule, readable by
 * a child standing on top of it.
 */
function buildExtender(def: ExtendingPlatformDef, groundY: number): LiveExtender {
  const group = new THREE.Group();
  // Flush with the ground: nudge the whole thing up so it doesn't z-fight.
  if (def.y - groundY < 1e-3) group.position.y = FLUSH_LIFT;
  const mat = MAGIC_MAT.clone();

  const slab = new THREE.Mesh(new THREE.BoxGeometry(def.w, EXT_THICKNESS, def.d), mat);
  slab.position.set(def.x, def.y - EXT_THICKNESS / 2, def.z);
  slab.castShadow = true;
  slab.receiveShadow = true;
  group.add(slab);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(slab.geometry as THREE.BoxGeometry),
    MAGIC_EDGE_MAT
  );
  edges.position.copy(slab.position);
  group.add(edges);

  // The arm is a unit cube; `syncMeshes` stretches it to however far it reaches.
  const arm = new THREE.Mesh(UNIT_BOX_GEO, mat);
  arm.castShadow = true;
  arm.receiveShadow = true;
  arm.visible = false;
  group.add(arm);

  const diamonds: THREE.Object3D[] = [];
  const bodyMat = diamondMaterial(def.when.color, def.when.side);
  for (let i = 0; i < def.when.count; i++) {
    const { dx, dz } = diamondOffset(i, def.when.count);
    const diamond = new THREE.Mesh(DIAMOND_GEO, bodyMat);
    if (def.when.side === 'night') {
      // A night mark is dark, exactly like a night crystal — the pale rim is
      // what keeps it readable against the platform's white face.
      diamond.add(new THREE.LineSegments(DIAMOND_EDGE_GEO, diamondEdgeMaterial(def.when.color)));
    }
    // Centered on the face, so the mark is set into the stone with its top half
    // showing — `syncMeshes` keeps the height right as a pillar grows.
    diamond.position.set(def.x + dx, markTopY(def, 0), def.z + dz);
    group.add(diamond);
    diamonds.push(diamond);
  }

  return { def, group, arm, mat, diamonds, reach: 0, wanted: false, stuck: false };
}
