// Pack intro cutscene: the camera falls out of the sky toward the player while
// day/night crystal pairs sail across the screen and annihilate, closing on the
// game title and the pack name. It plays over the live game scene, so the
// handoff at the end is just the chase camera taking the controls back.
//
// The crystals are parented to the camera rather than the world: the camera is
// travelling a long way during the sequence, and camera space keeps every
// crystal framed for free. Timing runs off this class's own clock instead of
// the shared tween system, which `loadLevel` clears out from under it.

import * as THREE from 'three';
import type { CrystalColor } from '../../../shared/types.ts';
import { easeInOut } from './anim.ts';
import { haloTexture, makeCrystalMesh } from './crystals.ts';
import { el, uiRoot } from '../screens/ui.ts';

/** Seconds. The camera glides from the sky to the player over this long. */
const DESCENT_END = 12.5;
/** When the player is comfortably in frame and may start walking. */
const CONTROL_AT = 9.4;
const PACK_AT = 9.0;
const TITLES_OUT_AT = 12.2;
const END = 13.6;

/** How far in front of the camera the crystal show plays out. */
const STAGE_Z = -16;
/** Off-screen x the crystals enter from (the stage is ~15 units half-wide). */
const ENTRY_X = 24;

/** Crystals rush in from off-screen and glide to a stop at the meeting point. */
function easeOut(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

interface PairSpec {
  color: CrystalColor;
  dayAt: number;
  nightAt: number;
  meetAt: number;
  meetX: number;
  meetY: number;
}

const COLORS: CrystalColor[] = ['red', 'blue', 'green', 'yellow', 'purple'];
/** Total day/night pairs in the show. */
const PAIR_COUNT = 20;
/** The rush of pairs after the solo opener sweeps in between these seconds... */
const RUSH_START = 3.4;
const RUSH_END = 8.2;
/** ...packing tighter as it goes (>1 bunches the later pairs together, so they
 *  arrive at an ever-increasing rate). */
const RUSH_ACCEL = 2.6;
/** Seconds a pair spends flying in before its two halves meet and annihilate. */
const TRAVEL = 1.4;
/** The last pair's entrance is the cue for the title, so it lands on the beat. */
const TITLE_AT = RUSH_END;

/** Small seeded PRNG so the scatter of meeting points is varied but stable. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The red pair goes first and alone, so the day-then-night-then-annihilate idea
// lands before the rest of the colors pile in; the remaining pairs then rush in
// at an accelerating rate, scattered across the stage.
function buildPairs(): PairSpec[] {
  const pairs: PairSpec[] = [
    { color: 'red', dayAt: 0.6, nightAt: 1.7, meetAt: 3.1, meetX: 0, meetY: 0.6 },
  ];
  const rng = mulberry32(0x4e696774); // "Nigt"
  const rush = PAIR_COUNT - 1;
  for (let i = 0; i < rush; i++) {
    const u = rush === 1 ? 1 : i / (rush - 1);
    const dayAt = RUSH_START + (RUSH_END - RUSH_START) * (1 - Math.pow(1 - u, RUSH_ACCEL));
    pairs.push({
      color: COLORS[i % COLORS.length],
      dayAt,
      nightAt: dayAt + 0.12,
      meetAt: dayAt + TRAVEL,
      meetX: (rng() - 0.5) * 13,
      meetY: (rng() - 0.5) * 7,
    });
  }
  return pairs;
}

const PAIRS: PairSpec[] = buildPairs();

interface Flier {
  root: THREE.Group;
  from: THREE.Vector3;
  to: THREE.Vector3;
  startAt: number;
  arriveAt: number;
  spin: number;
}

interface Pair {
  spec: PairSpec;
  day: Flier;
  night: Flier;
  spent: boolean;
}

interface Spark {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  grow: number;
}

export interface IntroOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  packName: string;
  /** Where the chase camera would like to be right now. */
  chasePose: () => { pos: THREE.Vector3; look: THREE.Vector3 };
  /** Fired once the player is in frame and may move. */
  onControlsUnlocked: () => void;
  /** Fired when the cutscene is over (or skipped) and the game takes over. */
  onFinish: () => void;
}

export class IntroSequence {
  /** Seconds of cutscene played. This advances on real elapsed time rather than
   *  the game loop's delta, which is clamped to 0.05s and would stretch the
   *  sequence to minutes on a slow machine. The per-frame cap is generous
   *  enough not to bite at any playable frame rate, but stops a one-off stall
   *  (shader compilation on the first frames, a backgrounded tab) from
   *  fast-forwarding past whole beats. */
  private time = 0;
  private lastTick = 0;
  private finished = false;
  private controlsUnlocked = false;
  private stage = new THREE.Group();
  private pairs: Pair[] = [];
  private sparks: Spark[] = [];
  private startPos: THREE.Vector3;
  private startLook: THREE.Vector3;
  private lookAt = new THREE.Vector3();
  private overlay: HTMLElement;
  private titleEl: HTMLElement;
  private packEl: HTMLElement;

  constructor(private opts: IntroOptions) {
    const anchor = opts.chasePose();
    // High over the plain but pulled well back, so the shot keeps the sunset
    // horizon in frame instead of staring straight down at the dirt.
    this.startLook = anchor.look.clone();
    this.startPos = new THREE.Vector3(anchor.look.x, anchor.look.y + 78, anchor.look.z + 132);
    opts.camera.position.copy(this.startPos);
    opts.camera.lookAt(this.startLook);

    // Camera-space staging only renders if the camera is in the scene graph.
    opts.scene.add(opts.camera);
    opts.camera.add(this.stage);

    for (const spec of PAIRS) this.pairs.push(this.buildPair(spec));

    this.titleEl = el('h1', {
      className: 'game-title intro-title',
      html: '<span class="night-word">Night</span> and <span class="day-word">Day</span>',
    });
    this.packEl = el('div', { className: 'intro-pack', text: opts.packName });
    this.overlay = el('div', { className: 'intro-overlay' }, [
      el('div', { className: 'intro-titles' }, [this.titleEl, this.packEl]),
      (() => {
        const skip = el('button', { className: 'menu-btn small intro-skip', text: 'Skip ⏭' });
        skip.addEventListener('click', () => this.skip());
        return skip;
      })(),
    ]);
    uiRoot().append(this.overlay);
  }

  private buildPair(spec: PairSpec): Pair {
    const meet = new THREE.Vector3(spec.meetX, spec.meetY, STAGE_Z);
    const make = (side: 'day' | 'night'): Flier => {
      const root = makeCrystalMesh(spec.color, side);
      root.scale.setScalar(1.7);
      root.visible = false;
      this.stage.add(root);
      // Day sweeps in from the left, night from the right, each with a little
      // vertical offset so they arc toward each other rather than sliding flat.
      const dir = side === 'day' ? -1 : 1;
      return {
        root,
        from: new THREE.Vector3(spec.meetX + dir * ENTRY_X, spec.meetY - dir * 3.5, STAGE_Z),
        to: meet.clone(),
        startAt: side === 'day' ? spec.dayAt : spec.nightAt,
        arriveAt: spec.meetAt,
        spin: side === 'day' ? 1.5 : -1.5,
      };
    };
    return { spec, day: make('day'), night: make('night'), spent: false };
  }

  private updateFlier(flier: Flier, dt: number): void {
    if (this.time < flier.startAt) return;
    flier.root.visible = true;
    const span = Math.max(0.001, flier.arriveAt - flier.startAt);
    const t = THREE.MathUtils.clamp((this.time - flier.startAt) / span, 0, 1);
    const e = easeOut(t);
    flier.root.position.lerpVectors(flier.from, flier.to, e);
    // A shallow arc so the pair swings together instead of colliding head-on.
    flier.root.position.y += Math.sin(e * Math.PI) * 2.4;
    flier.root.rotation.y += flier.spin * dt;
    flier.root.rotation.x += flier.spin * 0.3 * dt;
  }

  private annihilate(at: THREE.Vector3): void {
    const add = (color: number, scale: number, life: number, grow: number, velocity: THREE.Vector3) => {
      // Mapped with the halo gradient — an untextured sprite renders as a hard
      // square, which at this size reads as a bug rather than a flash.
      const material = new THREE.SpriteMaterial({
        map: haloTexture(),
        color,
        transparent: true,
        opacity: 1,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(at);
      sprite.scale.setScalar(scale);
      this.stage.add(sprite);
      this.sparks.push({ sprite, material, velocity, age: 0, life, grow });
    };

    add(0xfff3d0, 1.5, 0.7, 9, new THREE.Vector3());
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.random();
      const speed = 5 + Math.random() * 6;
      add(
        0xffe8a8,
        0.9,
        0.5 + Math.random() * 0.35,
        0,
        new THREE.Vector3(Math.cos(a) * speed, Math.sin(a) * speed, (Math.random() - 0.5) * 3)
      );
    }
  }

  private updateSparks(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const spark = this.sparks[i];
      spark.age += dt;
      const t = spark.age / spark.life;
      if (t >= 1) {
        this.stage.remove(spark.sprite);
        spark.material.dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      spark.sprite.position.addScaledVector(spark.velocity, dt);
      spark.velocity.multiplyScalar(1 - 2.2 * dt);
      spark.sprite.scale.setScalar(spark.sprite.scale.x + spark.grow * dt);
      spark.material.opacity = 1 - t;
    }
  }

  private updateCamera(): void {
    const chase = this.opts.chasePose();
    const t = THREE.MathUtils.clamp(this.time / DESCENT_END, 0, 1);
    const e = easeInOut(t);
    // Both ends of the lerp track the live chase pose, so by t=1 the cutscene
    // camera *is* the chase camera and the handoff is invisible.
    this.opts.camera.position.lerpVectors(this.startPos, chase.pos, e);
    this.lookAt.lerpVectors(this.startLook, chase.look, e);
    this.opts.camera.lookAt(this.lookAt);
  }

  private updateTitles(): void {
    this.titleEl.classList.toggle('visible', this.time >= TITLE_AT && this.time < TITLES_OUT_AT);
    this.packEl.classList.toggle('visible', this.time >= PACK_AT && this.time < TITLES_OUT_AT);
  }

  update(): void {
    if (this.finished) return;
    const now = performance.now();
    const dt = this.lastTick === 0 ? 0 : Math.min(0.5, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.time += dt;

    for (const pair of this.pairs) {
      if (pair.spent) continue; // annihilated: leave both crystals hidden
      this.updateFlier(pair.day, dt);
      this.updateFlier(pair.night, dt);
      if (this.time >= pair.spec.meetAt) {
        pair.spent = true;
        pair.day.root.visible = false;
        pair.night.root.visible = false;
        this.annihilate(pair.day.root.position.clone());
      }
    }
    this.updateSparks(dt);
    this.updateCamera();
    this.updateTitles();

    if (!this.controlsUnlocked && this.time >= CONTROL_AT) {
      this.controlsUnlocked = true;
      this.opts.onControlsUnlocked();
    }
    if (this.time >= END) this.finish();
  }

  /** Bail out: the camera jumps straight onto this player's character. */
  skip(): void {
    this.finish();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (!this.controlsUnlocked) {
      this.controlsUnlocked = true;
      this.opts.onControlsUnlocked();
    }
    this.dispose();
    this.opts.onFinish();
  }

  dispose(): void {
    this.finished = true;
    this.overlay.remove();
    for (const spark of this.sparks) spark.material.dispose();
    this.sparks = [];
    this.opts.camera.remove(this.stage);
    this.opts.scene.remove(this.opts.camera);
    this.stage.clear();
  }
}
