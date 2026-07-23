// Crystal rendering: transparent icosahedra clustered on a day platform and a
// night platform, one cluster per color per side, with floating count labels.
// Day crystals glow brightly; night crystals are dark with twinkling stars.

import * as THREE from 'three';
import type { CrystalColor, CrystalCounts, LevelDef, Side } from '../../../shared/types.ts';
import { easeInOut, easeOutBack, tween } from './anim.ts';
import type { Atmosphere } from './world.ts';

export const COLOR_HEX: Record<CrystalColor, { day: number; night: number; ui: string }> = {
  red: { day: 0xff6b5e, night: 0x7a1f33, ui: '#ff6b5e' },
  blue: { day: 0x64b5ff, night: 0x1f3c7a, ui: '#64b5ff' },
  green: { day: 0x7ce87c, night: 0x1f5c33, ui: '#7ce87c' },
  yellow: { day: 0xffe066, night: 0x7a6a1f, ui: '#ffe066' },
  purple: { day: 0xc98aff, night: 0x4a1f7a, ui: '#c98aff' },
};

export const DAY_PLATFORM_X = -10;
export const NIGHT_PLATFORM_X = 10;

export const CRYSTAL_RADIUS = 0.55;
const CRYSTAL_GEO = new THREE.IcosahedronGeometry(CRYSTAL_RADIUS, 0);
/** Facet outlines, used to rim night crystals so they read against the dark sky. */
const CRYSTAL_EDGES_GEO = new THREE.EdgesGeometry(CRYSTAL_GEO);

/**
 * The twinkling specks inside a night crystal (and orbiting a night generator).
 * Shared module-wide: `CrystalField` draws every crystal's specks as a single
 * `InstancedMesh`, so these must not be per-crystal allocations.
 */
export const STAR_GEO = new THREE.OctahedronGeometry(0.045);
export const STAR_MAT = new THREE.MeshBasicMaterial({ color: 0xeef2ff });

/** A pale, high-key version of a color — bright enough to glow at night. */
function edgeColor(color: CrystalColor): THREE.Color {
  return new THREE.Color(COLOR_HEX[color].day).lerp(new THREE.Color(0xffffff), 0.5);
}

/** Where a freshly generated crystal materializes: a generator's crown scaffold. */
export interface SpawnPoint {
  color: CrystalColor;
  side: Side;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** How long a newly generated crystal shows its "just made" flourish. */
const BURST_TIME = 1.6;

/** Twinkling specks held inside each night crystal. */
const STARS_PER_CRYSTAL = 4;
/** Room for 64 night crystals' worth of specks before the buffer has to grow. */
const STAR_CAPACITY_START = 256;

// Scratch objects for the per-frame star matrix maths — see `SKY_TMP` in
// generators.ts. Never allocate per star per frame.
const STAR_MATRIX = new THREE.Matrix4();
const STAR_LOCAL = new THREE.Matrix4();
const STAR_POS = new THREE.Vector3();
const STAR_SCALE = new THREE.Vector3();
const STAR_QUAT = new THREE.Quaternion();

/**
 * One twinkling speck inside a night crystal. Held as plain data rather than as
 * a child mesh: the specks are drawn from `CrystalField`'s shared
 * `InstancedMesh`, so each frame we compose a matrix from these numbers instead
 * of moving an Object3D.
 */
interface StarSpec {
  twinklePhase: number;
  /** Whirl-out parameters, used only during the birth flourish. */
  swirl: { angle: number; radius: number; y: number; speed: number };
}

/** The random speck layout shared by inline and instanced stars, so both look alike. */
function makeStarSpec(): StarSpec {
  const angle = Math.random() * Math.PI * 2;
  const radius = 0.28 + Math.random() * 0.2;
  return {
    twinklePhase: Math.random() * Math.PI * 2,
    swirl: { angle, radius, y: (Math.random() - 0.5) * 0.5, speed: 3.5 + Math.random() * 2.5 },
  };
}

interface CrystalMesh {
  root: THREE.Group;
  spin: number;
  bobPhase: number;
  slot: THREE.Vector3;
  /** Seconds of birth flourish left: day crystals glow, night ones swirl stars. */
  burst: number;
  /** Night crystals only — drawn via the field's instanced star mesh. */
  stars: StarSpec[];
}

interface Cluster {
  color: CrystalColor;
  side: Side;
  center: THREE.Vector3;
  crystals: CrystalMesh[];
  label: THREE.Sprite;
  labelCanvas: HTMLCanvasElement;
  labelTexture: THREE.CanvasTexture;
  lastText: string;
}

/**
 * Build one crystal. `inlineStars` adds a night crystal's specks as child meshes,
 * which is what the intro cutscene wants — it has a handful of crystals and never
 * animates the specks itself. `CrystalField` passes `false` and draws them from a
 * single instanced mesh instead, since a full platform of crystals would
 * otherwise cost four draw calls apiece.
 */
export function makeCrystalMesh(
  color: CrystalColor,
  side: Side,
  { inlineStars = true }: { inlineStars?: boolean } = {}
): THREE.Group {
  const group = new THREE.Group();
  const hex = COLOR_HEX[color][side];
  const mat = new THREE.MeshPhysicalMaterial({
    color: hex,
    transparent: true,
    opacity: side === 'day' ? 0.82 : 0.9,
    roughness: 0.15,
    metalness: 0.1,
    // No `transmission`: any transmissive material in the scene makes three
    // re-render the whole opaque scene into a mipmapped MSAA target every frame.
    // At 0.25 it was barely visible next to the opacity + emissive glow, so the
    // translucency is carried by those instead.
    emissive: hex,
    emissiveIntensity: side === 'day' ? 0.55 : 0.12,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(CRYSTAL_GEO, mat);
  mesh.castShadow = true;
  mesh.userData.body = true;
  mesh.userData.baseEmissive = mat.emissiveIntensity;
  group.add(mesh);

  if (side === 'day') {
    // Soft halo sprite for the glow.
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: haloTexture(),
        color: hex,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      })
    );
    halo.scale.setScalar(2.2);
    halo.userData.halo = true;
    halo.userData.baseOpacity = 0.45;
    group.add(halo);
  } else {
    // Bright facet outlines: under a night sky the dark body would otherwise
    // vanish, so the silhouette is drawn in a pale tint of the color. These
    // only show in the night atmosphere — `CrystalField.setAtmosphere` fades
    // them out for sunset and day, where the plain dark crystal reads fine.
    const bright = edgeColor(color);
    const edges = new THREE.LineSegments(
      CRYSTAL_EDGES_GEO,
      new THREE.LineBasicMaterial({ color: bright, transparent: true, opacity: 0.95, depthWrite: false })
    );
    edges.scale.setScalar(1.02);
    // Off until the field's update lights them (so a crystal born under a
    // sunset sky, or one in the intro cutscene, never flashes its edges).
    edges.visible = false;
    edges.userData.edges = true;
    edges.userData.baseOpacity = 0.95;
    group.add(edges);

    // Faint backface shell so the outline blooms a little, like moonlight
    // catching the crystal's rim.
    const rim = new THREE.Mesh(
      CRYSTAL_GEO,
      new THREE.MeshBasicMaterial({
        color: bright,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    rim.scale.setScalar(1.14);
    rim.visible = false;
    rim.userData.rim = true;
    rim.userData.baseOpacity = 0.22;
    group.add(rim);

    // Tiny star specks that twinkle, as if the crystal holds a night sky.
    if (inlineStars) {
      for (let i = 0; i < STARS_PER_CRYSTAL; i++) {
        const { swirl } = makeStarSpec();
        const star = new THREE.Mesh(STAR_GEO, STAR_MAT);
        star.position.set(Math.cos(swirl.angle) * swirl.radius, swirl.y, Math.sin(swirl.angle) * swirl.radius);
        group.add(star);
      }
    }
  }
  return group;
}

let haloTex: THREE.CanvasTexture | null = null;
/** Soft radial glow, shared by crystal halos and burst sparks. */
export function haloTexture(): THREE.CanvasTexture {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}

export class CrystalField {
  readonly group = new THREE.Group();
  private clusters = new Map<string, Cluster>();
  private time = 0;
  private colors: CrystalColor[];
  /** 0 = no night-crystal edge highlight, 1 = full. Eased toward `edgeTarget`. */
  private edgeFade = 0;
  private edgeTarget = 0;
  /** Every night crystal's specks, drawn in one call. Grows if a level needs it. */
  private starMesh!: THREE.InstancedMesh;

  constructor(
    private level: LevelDef,
    private heightAt: (x: number, z: number) => number
  ) {
    this.colors = collectColors(level);
    this.buildPlatform('day');
    this.buildPlatform('night');
    this.growStars(STAR_CAPACITY_START);
    for (const color of this.colors) {
      this.makeCluster(color, 'day');
      this.makeCluster(color, 'night');
    }
  }

  /**
   * (Re)allocate the instanced speck mesh to hold at least `needed` stars.
   * Crystal counts are unbounded — `currentCounts` just multiplies presses and
   * nothing caps them — so a player who keeps pressing can outgrow any fixed
   * buffer. Doubling keeps reallocation rare.
   */
  private growStars(needed: number): void {
    if (this.starMesh && needed <= this.starMesh.instanceMatrix.count) return;
    const capacity = this.starMesh
      ? Math.max(needed, this.starMesh.instanceMatrix.count * 2)
      : Math.max(needed, STAR_CAPACITY_START);
    if (this.starMesh) {
      this.group.remove(this.starMesh);
      this.starMesh.dispose(); // instance buffers only; STAR_GEO/STAR_MAT are shared
    }
    this.starMesh = new THREE.InstancedMesh(STAR_GEO, STAR_MAT, capacity);
    // An InstancedMesh's bounding sphere comes from the base geometry (a 0.045
    // octahedron at the origin), so leaving culling on would drop the whole mesh.
    this.starMesh.frustumCulled = false;
    this.starMesh.count = 0;
    this.group.add(this.starMesh);
  }

  private platformY(side: Side): number {
    const x = side === 'day' ? DAY_PLATFORM_X : NIGHT_PLATFORM_X;
    return this.heightAt(x, 0) + 0.35;
  }

  private buildPlatform(side: Side): void {
    const x = side === 'day' ? DAY_PLATFORM_X : NIGHT_PLATFORM_X;
    const depth = Math.max(1, this.colors.length) * 6 + 4;
    const geo = new THREE.CylinderGeometry(4.4, 5.0, 0.7, 8, 1);
    geo.scale(1, 1, depth / 8.8);
    const mat = new THREE.MeshStandardMaterial({
      color: side === 'day' ? 0xd9b98a : 0x3d4470,
      roughness: 0.85,
      flatShading: true,
    });
    const platform = new THREE.Mesh(geo, mat);
    platform.position.set(x, this.platformY(side) - 0.35, 0);
    platform.receiveShadow = true;
    platform.castShadow = true;
    this.group.add(platform);

    // Rim glow ring to mark whose side it is.
    const ringGeo = new THREE.TorusGeometry(4.7, 0.09, 8, 40);
    ringGeo.rotateX(Math.PI / 2);
    ringGeo.scale(1, 1, depth / 9.4);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: side === 'day' ? 0xffc776 : 0x8ea6ff })
    );
    ring.position.set(x, this.platformY(side) + 0.05, 0);
    this.group.add(ring);
  }

  private makeCluster(color: CrystalColor, side: Side): void {
    const i = this.colors.indexOf(color);
    const x = side === 'day' ? DAY_PLATFORM_X : NIGHT_PLATFORM_X;
    const z = (i - (this.colors.length - 1) / 2) * 6;
    const center = new THREE.Vector3(x, this.platformY(side), z);

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const texture = new THREE.CanvasTexture(canvas);
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
    );
    label.position.copy(center).add(new THREE.Vector3(0, 3.4, 0));
    label.scale.set(2.6, 1.3, 1);
    this.group.add(label);

    const cluster: Cluster = { color, side, center, crystals: [], label, labelCanvas: canvas, labelTexture: texture, lastText: '' };
    this.clusters.set(`${color}:${side}`, cluster);
    this.drawLabel(cluster, 0);
  }

  private drawLabel(cluster: Cluster, count: number): void {
    const text = String(count);
    if (text === cluster.lastText) return;
    cluster.lastText = text;
    const ctx = cluster.labelCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 128, 64);
    ctx.font = 'bold 40px Trebuchet MS';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(20,12,40,0.55)';
    roundRect(ctx, 24, 6, 80, 52, 12);
    ctx.fill();
    ctx.fillStyle = COLOR_HEX[cluster.color].ui;
    ctx.fillText(text, 64, 34);
    cluster.labelTexture.needsUpdate = true;
  }

  private slotFor(cluster: Cluster, index: number): THREE.Vector3 {
    // Spiral-ish grid: 3 columns along x, rows along z, stacking upward later.
    const perLayer = 9;
    const layer = Math.floor(index / perLayer);
    const k = index % perLayer;
    const col = k % 3;
    const row = Math.floor(k / 3);
    return new THREE.Vector3(
      cluster.center.x + (col - 1) * 1.5,
      cluster.center.y + 0.75 + layer * 1.3,
      cluster.center.z + (row - 1) * 1.5
    );
  }

  /**
   * Reconcile rendered crystals with the target counts. `spawnPoints` are the
   * crown scaffolds of the generator that was just pressed: new crystals
   * materialize inside their matching scaffold, then fly to their ring slot.
   */
  setCounts(counts: CrystalCounts, spawnPoints?: SpawnPoint[]): void {
    // One queue per color/side, consumed in order as crystals are created.
    const queues = new Map<string, SpawnPoint[]>();
    for (const p of spawnPoints ?? []) {
      const key = `${p.color}:${p.side}`;
      const q = queues.get(key);
      if (q) q.push(p);
      else queues.set(key, [p]);
    }

    for (const cluster of this.clusters.values()) {
      const target = counts[cluster.color]?.[cluster.side] ?? 0;
      while (cluster.crystals.length > target) {
        const c = cluster.crystals.pop()!;
        this.group.remove(c.root);
      }
      const queue = queues.get(`${cluster.color}:${cluster.side}`) ?? [];
      let spawned = 0;
      while (cluster.crystals.length < target) {
        const index = cluster.crystals.length;
        const slot = this.slotFor(cluster, index);
        const root = makeCrystalMesh(cluster.color, cluster.side, { inlineStars: false });
        const from = queue[spawned];
        const crystal: CrystalMesh = {
          root,
          spin: 0.4 + Math.random() * 0.5,
          bobPhase: Math.random() * Math.PI * 2,
          slot,
          burst: from ? BURST_TIME : 0,
          stars:
            cluster.side === 'night'
              ? Array.from({ length: STARS_PER_CRYSTAL }, makeStarSpec)
              : [],
        };
        cluster.crystals.push(crystal);
        this.group.add(root);
        if (from) {
          // Appear exactly where (and how) the scaffold sits, then fly over.
          const start = from.position.clone();
          const startQ = from.quaternion.clone();
          const endQ = new THREE.Quaternion();
          root.position.copy(start);
          root.quaternion.copy(startQ);
          tween({
            duration: 0.75,
            delay: 0.14 * spawned,
            onUpdate: (t) => {
              const e = easeInOut(t);
              root.position.lerpVectors(start, slot, e);
              root.position.y += Math.sin(e * Math.PI) * 2.2;
              root.quaternion.slerpQuaternions(startQ, endQ, e);
            },
          });
          spawned++;
        } else {
          root.position.copy(slot);
          root.scale.setScalar(0.01);
          tween({ duration: 0.4, onUpdate: (t) => root.scale.setScalar(0.01 + easeOutBack(t) * 0.99) });
        }
      }
      this.drawLabel(cluster, target);
    }

    let stars = 0;
    for (const cluster of this.clusters.values()) {
      for (const crystal of cluster.crystals) stars += crystal.stars.length;
    }
    this.growStars(stars);
  }

  /**
   * Night crystals only wear their bright edges under the night sky; sunset and
   * day keep the original dark look. Follows the world's cross-fade (pass
   * `animate` false on a fresh level load, which snaps like the sky does).
   */
  setAtmosphere(mode: Atmosphere, animate = true): void {
    this.edgeTarget = mode === 'night' ? 1 : 0;
    if (!animate) this.edgeFade = this.edgeTarget;
  }

  /** Positions used by the balance animation. */
  getClusters(): { color: CrystalColor; side: Side; crystals: THREE.Group[]; center: THREE.Vector3 }[] {
    return [...this.clusters.values()].map((c) => ({
      color: c.color,
      side: c.side,
      crystals: c.crystals.map((m) => m.root),
      center: c.center.clone(),
    }));
  }

  /** Instantly rebuild everything at its slot (after a failed balance). */
  restoreSlots(): void {
    for (const cluster of this.clusters.values()) {
      for (const crystal of cluster.crystals) {
        crystal.root.position.copy(crystal.slot);
        crystal.root.scale.setScalar(1);
        crystal.root.visible = true;
      }
    }
  }

  update(dt: number): void {
    this.time += dt;
    // ~1.3s to cross-fade the edges, roughly matching the sky's leg of a pass.
    const step = dt / 1.3;
    this.edgeFade =
      this.edgeFade < this.edgeTarget
        ? Math.min(this.edgeTarget, this.edgeFade + step)
        : Math.max(this.edgeTarget, this.edgeFade - step);
    let starCount = 0;
    for (const cluster of this.clusters.values()) {
      for (const crystal of cluster.crystals) {
        crystal.root.rotation.y += crystal.spin * dt;
        const bob = Math.sin(this.time * 1.6 + crystal.bobPhase) * 0.08;
        // Only bob when resting at the slot (not mid-animation).
        if (Math.abs(crystal.root.position.x - crystal.slot.x) < 0.01 && Math.abs(crystal.root.position.z - crystal.slot.z) < 0.01) {
          crystal.root.position.y = crystal.slot.y + bob;
        }
        // Birth flourish: 1 right after generation, fading to 0.
        const flourish = crystal.burst > 0 ? Math.min(1, crystal.burst / BURST_TIME) : 0;
        if (crystal.burst > 0) crystal.burst = Math.max(0, crystal.burst - dt);

        if (cluster.side === 'night') {
          for (const child of crystal.root.children) {
            if (child.userData.rim || child.userData.edges) {
              // Only lit under a night sky; also flares with the birth flourish.
              child.visible = this.edgeFade > 0.002;
              const mat = (child as THREE.Mesh).material as THREE.Material & { opacity: number };
              mat.opacity = Math.min(1, child.userData.baseOpacity * (1 + flourish * 1.8)) * this.edgeFade;
              if (child.userData.rim) child.scale.setScalar(1.14 + flourish * 0.25);
            }
          }
          // The specks live in the shared instanced mesh rather than under the
          // crystal, so their transforms are composed from the crystal's own
          // matrix below (see `updateStars`).
          starCount = this.updateStars(crystal, flourish, starCount);
        } else {
          for (const child of crystal.root.children) {
            const mat = (child as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
            if (child.userData.body && mat) {
              mat.emissiveIntensity = child.userData.baseEmissive * (1 + flourish * 3.0);
            } else if (child.userData.halo) {
              const halo = child as THREE.Sprite;
              const pulse = 1 + flourish * (1.4 + Math.sin(this.time * 9) * 0.3);
              halo.material.opacity = child.userData.baseOpacity * pulse;
              halo.scale.setScalar(2.2 * (1 + flourish * 0.6));
            }
          }
        }
      }
    }
    this.starMesh.count = starCount;
    this.starMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Write one night crystal's specks into the instanced mesh, starting at
   * `offset`, and return the next free slot. The twinkle and swirl formulas are
   * the ones the child meshes used to run; only the destination changed.
   */
  private updateStars(crystal: CrystalMesh, flourish: number, offset: number): number {
    if (crystal.stars.length === 0) return offset;
    // The specks are no longer children of the crystal, so a hidden crystal no
    // longer hides them for free — skipping the slots leaves them undrawn.
    // `playBalanceAnimation` relies on this when a pair annihilates.
    if (!crystal.root.visible) return offset;
    // Refresh the crystal's own matrix from its animated position/rotation/scale
    // — the spawn flight and the pop-in scale both drive those directly.
    crystal.root.updateMatrix();
    let i = offset;
    for (const star of crystal.stars) {
      const s = 0.6 + 0.55 * Math.sin(this.time * 3.2 + star.twinklePhase);
      STAR_SCALE.setScalar(Math.max(0.15, s) * (1 + flourish * 1.4));
      // At flourish 0 this evaluates to the star's resting spot, so the swirl
      // eases back home instead of snapping.
      const angle = star.swirl.angle + this.time * star.swirl.speed * flourish;
      const r = star.swirl.radius * (1 + flourish * 1.1);
      STAR_POS.set(
        Math.cos(angle) * r,
        star.swirl.y + Math.sin(angle * 2) * 0.3 * flourish,
        Math.sin(angle) * r
      );
      STAR_LOCAL.compose(STAR_POS, STAR_QUAT.identity(), STAR_SCALE);
      STAR_MATRIX.multiplyMatrices(crystal.root.matrix, STAR_LOCAL);
      this.starMesh.setMatrixAt(i++, STAR_MATRIX);
    }
    return i;
  }
}

export function collectColors(level: LevelDef): CrystalColor[] {
  const colors = new Set<CrystalColor>(Object.keys(level.initial) as CrystalColor[]);
  for (const gen of level.generators) for (const out of gen.outputs) colors.add(out.color);
  return [...colors];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
