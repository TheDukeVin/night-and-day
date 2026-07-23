// Crystal generators: a single clickable crystal floating over a glowing ring —
// no stone pedestal, so the crystal clusters on the ground stay visible behind
// it. Day generators glow warm with a bright ring; night generators are cooler
// with orbiting stars. A sign just below shows exactly what one press produces.

import * as THREE from 'three';
import type { CrystalColor, GeneratorDef, LevelDef, Side } from '../../../shared/types.ts';
import {
  collectColors,
  COLOR_HEX,
  CRYSTAL_RADIUS,
  DAY_PLATFORM_X,
  NIGHT_PLATFORM_X,
  STAR_GEO,
} from './crystals.ts';
import type { SpawnPoint } from './crystals.ts';
import { easeInOut, easeOutBack, tween } from './anim.ts';

// Scaffold geometry matches the crystal exactly, so a crystal appearing inside
// one lines up edge for edge.
const SCAFFOLD_GEO = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(CRYSTAL_RADIUS, 0));
const HULL_GEO = new THREE.IcosahedronGeometry(CRYSTAL_RADIUS, 0);

// How far a stand drops below its resting spot when hidden underground — enough
// to tuck the ring beneath the (opaque) terrain — and how long the rise/sink
// glides take.
const SINK_DEPTH = 4;
const RISE_TIME = 0.85;
const SINK_TIME = 0.7;
/** Resting height of the floating crystal above the ring (it bobs around this). */
const CROWN_Y = 2.4;
/** Horizontal radius a player is pushed out to when bumping a generator's spot;
 * kept snug so players can still slip between neighbours. */
export const PEDESTAL_COLLIDER_RADIUS = 1.1;

// Scratch vectors for the per-frame sky test, so it allocates nothing.
const SKY_TMP = new THREE.Vector3();
const SKY_TMP2 = new THREE.Vector3();

/** Star specks orbiting a night generator. */
const ORBIT_STARS = 6;
/** These read slightly larger than the crystals' specks; STAR_GEO is 0.045. */
const ORBIT_STAR_SCALE = 0.06 / 0.045;
/** Their own tint — a touch cooler than the specks inside a crystal. */
const ORBIT_STAR_MAT = new THREE.MeshBasicMaterial({ color: 0xdfe8ff });
// Scratch objects for the per-frame orbit matrices.
const ORBIT_MATRIX = new THREE.Matrix4();
const ORBIT_POS = new THREE.Vector3();
const ORBIT_SCALE = new THREE.Vector3().setScalar(ORBIT_STAR_SCALE);
const ORBIT_QUAT = new THREE.Quaternion();

interface OrbitSpec {
  angle: number;
  radius: number;
  speed: number;
  y: number;
}

export class GeneratorStand {
  readonly root = new THREE.Group();
  readonly def: GeneratorDef;
  readonly clickTargets: THREE.Object3D[] = [];
  private crown: THREE.Group;
  private crownSlots: { color: CrystalColor; node: THREE.Group }[] = [];
  private ring: THREE.Mesh;
  private sign!: THREE.Sprite;
  private signScale = new THREE.Vector3(1, 1, 1);
  /** White back-side shells around each crystal, shown while hovered. */
  private outlineShells: THREE.Mesh[] = [];
  private time = Math.random() * 10;
  /** Resting height of the stand; it animates up to this out of the ground. */
  private readonly groundY: number;
  /** True once the pedestal has fully risen and its cage/sign are shown. */
  private solid = false;
  /** Day-side cage edges, re-tinted each frame by how bright the sky behind is. */
  private dayScaffolds: THREE.LineSegments[] = [];
  /** Night stands only: the orbiting specks and the single mesh that draws them. */
  private orbits: OrbitSpec[] = [];
  private orbitMesh: THREE.InstancedMesh | null = null;
  /**
   * Cycle levels dim generators on the resting (non-active) side and make them
   * unclickable. Sunset levels keep every stand active. See `setActive`.
   */
  private active = true;
  private scaffoldMats: { mat: THREE.LineBasicMaterial; base: THREE.Color; dim: THREE.Color }[] = [];

  constructor(def: GeneratorDef, position: THREE.Vector3) {
    this.def = def;
    this.root.position.copy(position);
    this.groundY = position.y;

    const isDay = def.side === 'day';

    // Glow ring on the ground marking the side (the only thing left where the
    // pedestal used to stand — it lies flat, so it never hides ground crystals).
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.8, 0.08, 8, 32),
      new THREE.MeshBasicMaterial({ color: isDay ? 0xffc776 : 0x8ea6ff, transparent: true, opacity: 0.9 })
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.08;
    this.root.add(this.ring);

    // The crown: one empty scaffold per crystal produced (so "+2 red" shows two
    // red cages), hovering above the pedestal. Each is the wireframe of the
    // crystal that will be born inside it — same size, same orientation.
    this.crown = new THREE.Group();
    this.crown.position.y = CROWN_Y;
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide });
    const crownColors = def.outputs.flatMap((out) => Array<typeof out.color>(out.count).fill(out.color));
    const n = crownColors.length;
    const spacing = n <= 4 ? 1.2 : 4.8 / (n - 1);
    crownColors.forEach((color, i) => {
      // The crown reads against whatever sky is behind it, so it never uses the
      // dark night tint: bright edges over a dark silhouette stay legible on
      // both the warm day sky and the night one.
      const hex = COLOR_HEX[color].day;
      const slot = new THREE.Group();
      slot.position.x = n === 1 ? 0 : (i - (n - 1) / 2) * spacing;
      // Night cages sit against dark scenery, so a flat dark silhouette behind
      // the edges is what makes them read. Day cages stay bare wireframe — the
      // empty middle is what distinguishes a template from a real crystal — and
      // get their contrast from `shadeCrownForSky` instead.
      if (!isDay) {
        const silhouette = new THREE.Mesh(
          HULL_GEO,
          new THREE.MeshBasicMaterial({
            color: 0x14172e,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
          })
        );
        silhouette.scale.setScalar(0.98);
        slot.add(silhouette);
      }
      const scaffoldMat = new THREE.LineBasicMaterial({ color: hex });
      const scaffold = new THREE.LineSegments(SCAFFOLD_GEO, scaffoldMat);
      slot.add(scaffold);
      this.scaffoldMats.push({
        mat: scaffoldMat,
        base: scaffoldMat.color.clone(),
        dim: scaffoldMat.color.clone().multiplyScalar(0.4),
      });
      if (isDay) {
        // Same hue, deeper and more saturated: still obviously "the red cage",
        // but dark enough to hold its own against the sky.
        scaffoldMat.userData.baseColor = scaffoldMat.color.clone();
        scaffoldMat.userData.skyColor = scaffoldMat.color.clone().offsetHSL(0, 0.12, -0.34);
        this.dayScaffolds.push(scaffold);
      }
      // White back-side shell shown while the player hovers the crystal.
      const shell = new THREE.Mesh(HULL_GEO, outlineMat);
      shell.scale.setScalar(1.12);
      shell.visible = false;
      slot.add(shell);
      this.outlineShells.push(shell);
      // Lines are hard to hit with a raycast, so click the invisible hull.
      const hull = new THREE.Mesh(
        HULL_GEO,
        new THREE.MeshBasicMaterial({ visible: false })
      );
      slot.add(hull);
      this.crown.add(slot);
      this.crownSlots.push({ color, node: slot });
      this.clickTargets.push(hull);
    });
    this.root.add(this.crown);

    // Sign showing the output, e.g. "+2 ◆  +1 ◆". Clicking it presses too.
    // It sits just below the floating crystal, low enough to stay clear of the
    // crystal clusters behind when you look at the scene head-on.
    const sign = makeSignSprite(def);
    sign.position.set(0, 1.0, 0.5);
    this.root.add(sign);
    this.clickTargets.push(sign);
    this.sign = sign;
    this.signScale.copy(sign.scale);

    if (!isDay) {
      // Orbiting star specks for night generators, drawn in one call from the
      // same shared octahedron the crystals' specks use.
      this.orbits = Array.from({ length: ORBIT_STARS }, (_, i) => ({
        angle: (i / ORBIT_STARS) * Math.PI * 2,
        radius: 1.35,
        speed: 0.8 + Math.random() * 0.4,
        y: 1.4 + Math.random() * 1.2,
      }));
      this.orbitMesh = new THREE.InstancedMesh(STAR_GEO, ORBIT_STAR_MAT, ORBIT_STARS);
      // Bounding sphere comes from the base geometry at the origin, so leaving
      // culling on would drop the whole mesh once the stand is off-centre.
      this.orbitMesh.frustumCulled = false;
      this.root.add(this.orbitMesh);
    }

    for (const target of this.clickTargets) target.userData.generatorId = def.id;

    // Start hidden underground: the cage scaffold and sign only appear once the
    // pedestal has risen (see `riseIn`), so nothing pops in mid-air.
    this.setAdornmentsVisible(false);
    this.root.position.y = this.groundY - SINK_DEPTH;
  }

  /**
   * Cycle levels call this to light up the active side and grey out the resting
   * one. Inactive stands are dimmed (stone, cage edges, ring, sign) and are
   * skipped by hover/click (see `GameController`). Sunset levels leave every
   * stand active.
   */
  setActive(active: boolean): void {
    this.active = active;
    (this.ring.material as THREE.MeshBasicMaterial).opacity = active ? 0.9 : 0.1;
    for (const s of this.scaffoldMats) s.mat.color.copy(active ? s.base : s.dim);
    (this.sign.material as THREE.SpriteMaterial).opacity = active ? 1 : 0.3;
    if (!active) for (const shell of this.outlineShells) shell.visible = false;
  }

  /** Whether this generator is currently the active side (always true on Sunset). */
  isActive(): boolean {
    return this.active;
  }

  /** Toggle the white hover outline. */
  setHovered(on: boolean): void {
    if (!this.active) return;
    for (const shell of this.outlineShells) shell.visible = on;
  }

  /** Whether the pedestal has finished rising and can be pressed / collided with. */
  isSolid(): boolean {
    return this.solid;
  }

  /** Crown cage and output sign — shown only after the pedestal is up. */
  private setAdornmentsVisible(on: boolean): void {
    this.crown.visible = on;
    this.sign.visible = on;
  }

  /** Rise out of the ground, then pop the cage scaffold and sign into place. */
  riseIn(delay = 0): void {
    this.solid = false;
    this.setAdornmentsVisible(false);
    this.root.position.y = this.groundY - SINK_DEPTH;
    tween({
      duration: RISE_TIME,
      delay,
      onUpdate: (t) => {
        this.root.position.y = this.groundY - SINK_DEPTH * (1 - easeInOut(t));
      },
      onDone: () => this.revealAdornments(),
    });
  }

  /** Sink back into the ground (cage/sign vanish first). */
  sinkOut(delay = 0, onDone?: () => void): void {
    this.solid = false;
    this.setAdornmentsVisible(false);
    tween({
      duration: SINK_TIME,
      delay,
      onUpdate: (t) => {
        this.root.position.y = this.groundY - SINK_DEPTH * easeInOut(t);
      },
      onDone,
    });
  }

  private revealAdornments(): void {
    this.solid = true;
    this.root.position.y = this.groundY;
    this.setAdornmentsVisible(true);
    this.crown.scale.setScalar(0.01);
    this.sign.scale.set(0.01, 0.01, 1);
    tween({
      duration: 0.4,
      onUpdate: (t) => {
        const s = 0.01 + easeOutBack(t) * 0.99;
        this.crown.scale.setScalar(s);
        this.sign.scale.set(this.signScale.x * s, this.signScale.y * s, 1);
      },
    });
  }

  /**
   * Where this generator's crystals are born: the world transform of each crown
   * scaffold, so the crystal appears in the cage it came out of.
   */
  getSpawnPoints(): SpawnPoint[] {
    this.root.updateMatrixWorld(true);
    return this.crownSlots.map(({ color, node }) => ({
      color,
      side: this.def.side,
      position: node.getWorldPosition(new THREE.Vector3()),
      quaternion: node.getWorldQuaternion(new THREE.Quaternion()),
    }));
  }

  /** Quick pulse when pressed. */
  pulse(): void {
    tween({
      duration: 0.35,
      onUpdate: (t) => {
        const s = 1 + Math.sin(t * Math.PI) * 0.25;
        this.crown.scale.setScalar(s);
      },
    });
  }

  /** Brief red-ish flash when the wrong player clicks it. */
  deny(): void {
    const mat = this.ring.material as THREE.MeshBasicMaterial;
    const original = mat.color.getHex();
    mat.color.setHex(0xff5050);
    tween({ duration: 0.5, onUpdate: () => {}, onDone: () => mat.color.setHex(original) });
  }

  /**
   * Day cages lose their bright pastel against the sky, so darken the edges as
   * the crown drifts up in front of it. "Against sky" is judged by the pitch of
   * the camera→crown ray: looking level or up means open sky behind, looking
   * down means the darker platform and terrain. The band is wide enough that
   * walking around a generator fades between the two rather than snapping.
   */
  private shadeCrownForSky(camera: THREE.Camera): void {
    if (this.dayScaffolds.length === 0) return;
    const crown = this.crown.getWorldPosition(SKY_TMP).sub(camera.getWorldPosition(SKY_TMP2));
    const pitch = crown.y / (crown.length() || 1);
    // 0 below the horizon (dark scenery behind) → 1 well above it (bright sky).
    const t = THREE.MathUtils.smoothstep(pitch, -0.05, 0.18);
    for (const scaffold of this.dayScaffolds) {
      const mat = scaffold.material as THREE.LineBasicMaterial;
      const base = mat.userData.baseColor as THREE.Color;
      const deep = mat.userData.skyColor as THREE.Color;
      mat.color.copy(base).lerp(deep, t);
    }
  }

  update(dt: number, camera?: THREE.Camera): void {
    this.time += dt;
    // While dimmed, skip the per-frame ring pulse and sky re-tint so they don't
    // fight the deactivated colours set in `setActive`.
    if (this.active && camera) this.shadeCrownForSky(camera);
    this.crown.rotation.y += dt * 0.9;
    this.crown.position.y = CROWN_Y + Math.sin(this.time * 1.8) * 0.15;
    const ringMat = this.ring.material as THREE.MeshBasicMaterial;
    if (this.active) ringMat.opacity = 0.65 + Math.sin(this.time * 2.4) * 0.25;
    if (this.orbitMesh) {
      this.orbits.forEach((orbit, i) => {
        orbit.angle += dt * orbit.speed;
        ORBIT_POS.set(
          Math.cos(orbit.angle) * orbit.radius,
          orbit.y + Math.sin(orbit.angle * 2) * 0.15,
          Math.sin(orbit.angle) * orbit.radius
        );
        ORBIT_MATRIX.compose(ORBIT_POS, ORBIT_QUAT.identity(), ORBIT_SCALE);
        this.orbitMesh!.setMatrixAt(i, ORBIT_MATRIX);
      });
      this.orbitMesh.instanceMatrix.needsUpdate = true;
    }
  }
}

function makeSignSprite(def: GeneratorDef): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(20,12,40,0.6)';
  const w = 40 + def.outputs.length * 88;
  const x0 = (256 - w) / 2;
  ctx.beginPath();
  ctx.roundRect(x0, 14, w, 68, 14);
  ctx.fill();
  ctx.strokeStyle = def.side === 'day' ? 'rgba(255,199,118,0.9)' : 'rgba(142,166,255,0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.textBaseline = 'middle';
  def.outputs.forEach((out, i) => {
    const cx = x0 + 20 + i * 88;
    ctx.font = 'bold 34px Trebuchet MS';
    ctx.fillStyle = '#fff3e2';
    ctx.textAlign = 'left';
    ctx.fillText(`+${out.count}`, cx, 50);
    // Diamond swatch in the crystal color.
    ctx.fillStyle = COLOR_HEX[out.color].ui;
    const dx = cx + 52;
    ctx.beginPath();
    ctx.moveTo(dx, 32);
    ctx.lineTo(dx + 15, 48);
    ctx.lineTo(dx, 64);
    ctx.lineTo(dx - 15, 48);
    ctx.closePath();
    ctx.fill();
  });

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(4.4, 1.65, 1);
  return sprite;
}

/**
 * Lay out all generators for a level: a row per side in front of (+z of) that
 * side's crystal platform, so players see both rings and the generators at once.
 */
export function buildGenerators(level: LevelDef, heightAt: (x: number, z: number) => number): GeneratorStand[] {
  // Clear the platform's front edge (its footprint stretches along z with the color count).
  const depth = Math.max(1, collectColors(level).length) * 6 + 4;
  const frontZ = (5.0 * depth) / 8.8 + 3;
  const stands: GeneratorStand[] = [];
  for (const side of ['day', 'night'] as Side[]) {
    const gens = level.generators.filter((g) => g.side === side);
    // Nudged toward the middle so outer stands stay on screen from spawn.
    const centerX = side === 'day' ? DAY_PLATFORM_X + 2 : NIGHT_PLATFORM_X - 2;
    gens.forEach((def, i) => {
      const x = centerX + (i - (gens.length - 1) / 2) * 5;
      const pos = new THREE.Vector3(x, heightAt(x, frontZ), frontZ);
      stands.push(new GeneratorStand(def, pos));
    });
  }
  return stands;
}
