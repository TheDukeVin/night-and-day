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

import * as THREE from 'three';
import type { BoxDef, LevelTerrain, PlatformDef } from '../../../shared/types.ts';
import { BOX_SIZE } from '../../../shared/skyway.ts';

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

const STONE_MAT = new THREE.MeshStandardMaterial({ color: 0x8d8779, roughness: 0.95, flatShading: true });
const STONE_TOP_MAT = new THREE.MeshStandardMaterial({ color: 0xa8a292, roughness: 0.9, flatShading: true });

/** Crates are warmer and rune-lit so they read as "this one moves". */
const CRATE_MAT = new THREE.MeshStandardMaterial({ color: 0xb59263, roughness: 0.8, flatShading: true });
const CRATE_EDGE_MAT = new THREE.LineBasicMaterial({ color: 0xffe0a8 });
const CRATE_EDGE_GEO = new THREE.EdgesGeometry(new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE));

export class Terrain {
  readonly group = new THREE.Group();
  private platforms: PlatformDef[] = [];
  private boxes: LiveBox[] = [];
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
    this.syncMeshes();
  }

  get hasTerrain(): boolean {
    return this.platforms.length > 0 || this.boxes.length > 0;
  }

  // ---------- Queries ----------

  /** Every solid right now: static platforms plus wherever the crates ended up. */
  private slabs(): Slab[] {
    const out = this.platformSlabs.slice();
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

  // ---------- Per-frame ----------

  /** Let unsupported crates fall (pushing one off a ledge drops it to the floor). */
  update(dt: number): void {
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
      // Materials and the crate edge geometry are module-level and shared.
      if (mesh.geometry && mesh.geometry !== CRATE_EDGE_GEO) mesh.geometry.dispose();
    });
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
