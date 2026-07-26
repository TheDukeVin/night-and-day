// Skyway terrain, drawn: the meshes for stone platforms, crates and extending
// platforms, laid over the shared model that decides where they all are.
//
// The physics and collision half lives in `shared/terrain.ts` (`TerrainSim`),
// because crates and arms are game state the authoritative session owns. This
// module holds a sim of its own and steps it every frame as a **prediction**, so
// pushing a crate moves it under your hands with no round trip, and adopts the
// session's snapshots when they arrive (`applySnapshot`). The visual position of
// a crate is the sim position plus a decaying offset, so a correction slides
// into place instead of popping.
//
// Meshes and collision still have to agree exactly — a crate you can see beside
// a platform must also be a step you can stand on — which is why the renderer
// reads the very same slabs the sim collides against, and never its own copy.

import * as THREE from 'three';
import type { HeightField } from '../../../shared/ground.ts';
import {
  ACTOR_HEIGHT,
  armSlab,
  BOX_SIZE,
  EXT_THICKNESS,
  markTopY,
  PLATFORM_DEPTH,
  STEP_UP,
  TerrainSim,
} from '../../../shared/terrain.ts';
import type {
  CratePush,
  CrateState,
  ExtenderState,
  TerrainBody,
  TerrainSnapshot,
} from '../../../shared/terrain.ts';
import type {
  CrystalCounts,
  ExtendingPlatformDef,
  LevelTerrain,
  PlatformDef,
} from '../../../shared/types.ts';
import { COLOR_HEX } from './crystals.ts';

export { ACTOR_HEIGHT, BOX_SIZE, STEP_UP };

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

/**
 * How fast a correction from the session is absorbed: the leftover offset decays
 * to a tenth of itself every `CORRECT_TAU` seconds. Normal motion is drawn
 * exactly (the offset is zero), so this only ever smooths a disagreement.
 */
const CORRECT_TAU = 0.09;

/** A correction bigger than this is a different place entirely: just cut to it. */
const CORRECT_SNAP = 1.5;

/** One crate's meshes plus the visual offset left over from the last correction. */
interface CrateView {
  state: CrateState;
  mesh: THREE.Group;
  ox: number;
  oy: number;
  oz: number;
}

/** One extending platform's meshes, alongside the sim state that drives them. */
interface ExtenderView {
  state: ExtenderState;
  def: ExtendingPlatformDef;
  group: THREE.Group;
  /** The growing arm: a unit cube, scaled and placed from `reach` every frame. */
  arm: THREE.Mesh;
  /** Slab + arm share this clone so both brighten together when the count matches. */
  mat: THREE.MeshStandardMaterial;
  /** The condition marks, spun gently so they catch the eye from a distance. */
  diamonds: THREE.Object3D[];
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
  /** The predicted model; the session's copy is the one that counts. */
  readonly sim: TerrainSim;
  private crateViews: CrateView[] = [];
  private extenderViews: ExtenderView[] = [];

  constructor(def: LevelTerrain | null | undefined, heightAt: HeightField) {
    this.sim = new TerrainSim(def, heightAt);
    if (!def) return;
    for (const p of def.platforms) this.group.add(buildPlatformMesh(p));
    for (const state of this.sim.crates) {
      const mesh = buildCrateMesh();
      this.group.add(mesh);
      this.crateViews.push({ state, mesh, ox: 0, oy: 0, oz: 0 });
    }
    for (const state of this.sim.extenders) {
      const edef = this.sim.defOf(state);
      const view = buildExtender(state, edef, heightAt(edef.x, edef.z));
      this.group.add(view.group);
      this.extenderViews.push(view);
    }
    this.syncMeshes();
  }

  get isPlatformer(): boolean {
    return this.sim.isPlatformer;
  }

  get hasExtenders(): boolean {
    return this.sim.hasExtenders;
  }

  // ---------- Queries the player asks ----------

  supportAt(x: number, z: number, feetY: number): number {
    return this.sim.supportAt(x, z, feetY);
  }

  resolve(pos: { x: number; z: number }, radius: number, feetY: number, push: boolean): void {
    this.sim.resolve(pos, radius, feetY, push);
  }

  /** Tell the model who the local player is, so arms can shove them. */
  setPlayer(player: TerrainBody | null): void {
    this.sim.setBody('local', player);
  }

  /** …and where the other player is standing, from their last pose. */
  setPeer(body: TerrainBody | null): void {
    this.sim.setBody('peer', body);
  }

  // ---------- State ----------

  setCounts(counts: CrystalCounts, animate = true): void {
    this.sim.setCounts(counts, animate);
    this.syncMeshes();
  }

  /**
   * Adopt the session's terrain. Whatever this client had predicted becomes a
   * visual offset that decays away over the next few frames, so the crate slides
   * to where it really is rather than jumping there.
   */
  applySnapshot(snap: TerrainSnapshot): void {
    for (const view of this.crateViews) {
      const before = { x: view.state.x, y: view.state.y, z: view.state.z };
      const inc = snap.crates.find((c) => c.id === view.state.id);
      if (!inc) continue;
      view.ox += before.x - inc.x;
      view.oy += before.y - inc.y;
      view.oz += before.z - inc.z;
      if (Math.hypot(view.ox, view.oy, view.oz) > CORRECT_SNAP) {
        view.ox = 0;
        view.oy = 0;
        view.oz = 0;
      }
    }
    this.sim.applySnapshot(snap);
    this.syncMeshes();
  }

  /** Crate pushes this client made, to report to the session. */
  takePushes(): CratePush[] | null {
    return this.sim.takePushes();
  }

  /** Put every crate back on its authored mark (Reset). */
  restore(): void {
    for (const view of this.crateViews) {
      view.ox = 0;
      view.oy = 0;
      view.oz = 0;
    }
    this.sim.restore();
    this.syncMeshes();
  }

  // ---------- Per-frame ----------

  update(dt: number): void {
    this.sim.step(dt);
    // Decay whatever was left over from the last correction.
    const keep = Math.pow(0.1, dt / CORRECT_TAU);
    for (const view of this.crateViews) {
      view.ox *= keep;
      view.oy *= keep;
      view.oz *= keep;
    }
    for (const view of this.extenderViews) {
      // Lit while it is out, so the platform itself answers "is my count right?".
      const out = this.sim.extension(view.state);
      view.mat.emissiveIntensity = 0.2 + out * 0.55;
      // Waiting on someone: throb, so a platform that stopped early reads as
      // "something is in my way" rather than as broken.
      if (view.state.stuck) {
        view.mat.emissiveIntensity += 0.3 * (0.5 + 0.5 * Math.sin(performance.now() * 0.008));
      }
      for (const d of view.diamonds) d.rotation.y += dt * 1.1;
    }
    this.syncMeshes();
  }

  private syncMeshes(): void {
    for (const view of this.crateViews) {
      view.mesh.position.set(
        view.state.x + view.ox,
        view.state.y + view.oy + BOX_SIZE / 2,
        view.state.z + view.oz
      );
    }
    for (const view of this.extenderViews) {
      const topY = markTopY(view.def, view.state.reach);
      for (const d of view.diamonds) d.position.y = topY;
      const arm = armSlab(view.def, view.state.reach);
      view.arm.visible = arm !== null;
      if (!arm) continue;
      view.arm.position.set(arm.cx, (arm.top + arm.bottom) / 2, arm.cz);
      view.arm.scale.set(arm.hw * 2, arm.top - arm.bottom, arm.hd * 2);
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      // Most materials and several geometries are module-level and shared.
      if (mesh.geometry && !SHARED_GEOS.has(mesh.geometry)) mesh.geometry.dispose();
    });
    // Each extending platform owns a clone, so it can light up on its own.
    for (const view of this.extenderViews) view.mat.dispose();
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
function buildExtender(state: ExtenderState, def: ExtendingPlatformDef, groundY: number): ExtenderView {
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

  return { state, def, group, arm, mat, diamonds };
}
