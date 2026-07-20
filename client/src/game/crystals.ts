// Crystal rendering: transparent icosahedra clustered on a day platform and a
// night platform, one cluster per color per side, with floating count labels.
// Day crystals glow brightly; night crystals are dark with twinkling stars.

import * as THREE from 'three';
import type { CrystalColor, CrystalCounts, LevelDef, Side } from '../../../shared/types.ts';
import { easeInOut, easeOutBack, tween } from './anim.ts';

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

/** Where a freshly generated crystal materializes: a generator's crown scaffold. */
export interface SpawnPoint {
  color: CrystalColor;
  side: Side;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** How long a newly generated crystal shows its "just made" flourish. */
const BURST_TIME = 1.6;

interface CrystalMesh {
  root: THREE.Group;
  spin: number;
  bobPhase: number;
  slot: THREE.Vector3;
  /** Seconds of birth flourish left: day crystals glow, night ones swirl stars. */
  burst: number;
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

export function makeCrystalMesh(color: CrystalColor, side: Side): THREE.Group {
  const group = new THREE.Group();
  const hex = COLOR_HEX[color][side];
  const mat = new THREE.MeshPhysicalMaterial({
    color: hex,
    transparent: true,
    opacity: side === 'day' ? 0.82 : 0.9,
    roughness: 0.15,
    metalness: 0.1,
    transmission: 0.25,
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
    // Tiny star specks that twinkle, as if the crystal holds a night sky.
    const starMat = new THREE.MeshBasicMaterial({ color: 0xeef2ff });
    for (let i = 0; i < 4; i++) {
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), starMat);
      const a = Math.random() * Math.PI * 2;
      const r = 0.28 + Math.random() * 0.2;
      star.position.set(Math.cos(a) * r, (Math.random() - 0.5) * 0.5, Math.sin(a) * r);
      star.userData.twinklePhase = Math.random() * Math.PI * 2;
      // Swirl parameters, used only during the birth flourish.
      star.userData.swirl = { angle: a, radius: r, y: star.position.y, speed: 3.5 + Math.random() * 2.5 };
      group.add(star);
    }
  }
  return group;
}

let haloTex: THREE.CanvasTexture | null = null;
function haloTexture(): THREE.CanvasTexture {
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

  constructor(
    private level: LevelDef,
    private heightAt: (x: number, z: number) => number
  ) {
    this.colors = collectColors(level);
    this.buildPlatform('day');
    this.buildPlatform('night');
    for (const color of this.colors) {
      this.makeCluster(color, 'day');
      this.makeCluster(color, 'night');
    }
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
        const root = makeCrystalMesh(cluster.color, cluster.side);
        const from = queue[spawned];
        const crystal: CrystalMesh = {
          root,
          spin: 0.4 + Math.random() * 0.5,
          bobPhase: Math.random() * Math.PI * 2,
          slot,
          burst: from ? BURST_TIME : 0,
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
            const phase = child.userData.twinklePhase;
            if (phase !== undefined) {
              const s = 0.6 + 0.55 * Math.sin(this.time * 3.2 + phase);
              child.scale.setScalar(Math.max(0.15, s) * (1 + flourish * 1.4));
            }
            const swirl = child.userData.swirl;
            // At flourish 0 this evaluates to the star's resting spot, so the
            // swirl eases back home instead of snapping.
            if (swirl) {
              // Stars whirl out and around the new crystal, then settle back.
              const angle = swirl.angle + this.time * swirl.speed * flourish;
              const r = swirl.radius * (1 + flourish * 1.1);
              child.position.set(
                Math.cos(angle) * r,
                swirl.y + Math.sin(angle * 2) * 0.3 * flourish,
                Math.sin(angle) * r
              );
            }
          }
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
