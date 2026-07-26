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
const ACTOR_HEIGHT = 2.2;

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
/** How far the diamonds hover above the slab's top face. */
const DIAMOND_HOVER = 0.42;

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
/**
 * The arrow that shows which way a slab will reach, even while retracted. Inked
 * rather than white: on a white face, white would be invisible.
 */
const MAGIC_ARROW_MAT = new THREE.MeshBasicMaterial({ color: 0x4a5590 });
const ARROW_GEO = new THREE.ConeGeometry(0.3, 0.62, 4);
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
  /** Seconds since load, for the diamonds' spin and bob. */
  private time = 0;
  /** Platform slabs never change, so they are built once and reused per frame. */
  private platformSlabs: Slab[] = [];
  /** Set whenever a crate moves; the controller relays the new spots to the peer. */
  private boxesDirty = false;

  constructor(
    def: LevelTerrain | null | undefined,
    private heightAt: (x: number, z: number) => number
  ) {
    if (!def) return;
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
      const live = buildExtender(e);
      this.group.add(live.group);
      this.extenders.push(live);
    }
    this.syncMeshes();
  }

  get hasTerrain(): boolean {
    return this.platforms.length > 0 || this.boxes.length > 0 || this.extenders.length > 0;
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
  private slabs(): Slab[] {
    const out = this.platformSlabs.slice();
    for (const e of this.extenders) {
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
    this.time += dt;
    for (const e of this.extenders) {
      const target = e.wanted ? e.def.length : 0;
      const step = EXT_RATE * dt;
      e.reach = e.reach < target ? Math.min(target, e.reach + step) : Math.max(target, e.reach - step);
      // Lit while it is out, so the platform itself answers "is my count right?".
      const out = e.def.length > 0 ? e.reach / e.def.length : 0;
      e.mat.emissiveIntensity = 0.2 + out * 0.55;
      for (let i = 0; i < e.diamonds.length; i++) {
        const d = e.diamonds[i];
        d.rotation.y += dt * 1.1;
        d.position.y = e.def.y + DIAMOND_HOVER + Math.sin(this.time * 2 + i * 0.5) * 0.05;
      }
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
  ARROW_GEO,
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

/** Which way the arrow on the slab's face points, and where it sits. */
function arrowPlacement(def: ExtendingPlatformDef): { rot: THREE.Euler; dx: number; dz: number; dy: number } {
  const edgeX = (def.w / 2) * 0.6;
  const edgeZ = (def.d / 2) * 0.6;
  switch (def.dir) {
    case '+x':
      return { rot: new THREE.Euler(0, 0, -Math.PI / 2), dx: edgeX, dz: 0, dy: 0.45 };
    case '-x':
      return { rot: new THREE.Euler(0, 0, Math.PI / 2), dx: -edgeX, dz: 0, dy: 0.45 };
    case '+z':
      return { rot: new THREE.Euler(Math.PI / 2, 0, 0), dx: 0, dz: edgeZ, dy: 0.45 };
    case '-z':
      return { rot: new THREE.Euler(-Math.PI / 2, 0, 0), dx: 0, dz: -edgeZ, dy: 0.45 };
    case '+y':
      return { rot: new THREE.Euler(0, 0, 0), dx: 0, dz: 0, dy: 1.0 };
    case '-y':
      return { rot: new THREE.Euler(Math.PI, 0, 0), dx: 0, dz: 0, dy: 0.45 };
  }
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
 * A white slab, its direction arrow, and one mini crystal per crystal the
 * condition asks for — a level's whole "when does this appear?" rule, readable
 * by a child standing on top of it.
 */
function buildExtender(def: ExtendingPlatformDef): LiveExtender {
  const group = new THREE.Group();
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

  const place = arrowPlacement(def);
  const arrow = new THREE.Mesh(ARROW_GEO, MAGIC_ARROW_MAT);
  arrow.position.set(def.x + place.dx, def.y + place.dy, def.z + place.dz);
  arrow.rotation.copy(place.rot);
  group.add(arrow);

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
    diamond.position.set(def.x + dx, def.y + DIAMOND_HOVER, def.z + dz);
    group.add(diamond);
    diamonds.push(diamond);
  }

  return { def, group, arm, mat, diamonds, reach: 0, wanted: false };
}
