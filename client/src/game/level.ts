// The in-game controller: owns the renderer/scene for a play session, loads
// levels, routes input to the game channel and reacts to authoritative state.

import * as THREE from 'three';
import { WORLD_SEED } from '../../../shared/ground.ts';
import { getLevel, getPack, levelCount } from '../../../shared/packs.ts';
import { activeSide, canPass, currentCounts, generatorLabel, isCycle, undoIndexFor } from '../../../shared/logic.ts';
import type { TerrainSnapshot } from '../../../shared/terrain.ts';
import { ACTOR_HEIGHT, PLAYER_RADIUS } from '../../../shared/terrain.ts';
import type { GameState, LevelDef, PlayerPose, ServerMsg, Side } from '../../../shared/types.ts';
import type { GameChannel } from '../net/client.ts';
import { cameraMode, getSettings, pixelRatioFor, setCameraModeOverride } from '../settings.ts';
import { Hud } from '../screens/hud.ts';
import { dismissToast, el, showDialog, showToast, uiRoot } from '../screens/ui.ts';
import { clearTweens, updateTweens } from './anim.ts';
import { playBalanceAnimation } from './balance.ts';
import { CrystalField } from './crystals.ts';
import type { SpawnPoint } from './crystals.ts';
import { buildGenerators, GeneratorStand, PEDESTAL_COLLIDER_RADIUS, RING_RADIUS } from './generators.ts';
import { Guides } from './guides.ts';
import { IntroSequence } from './intro.ts';
import { Player, RemotePlayer } from './player.ts';
import { Terrain } from './platforms.ts';
import { hasSeenMechanic } from '../mechanics.ts';
import { Tutorial } from './tutorial.ts';
import { Walkthrough } from './walkthrough.ts';
import { World } from './world.ts';
import type { Atmosphere } from './world.ts';

const INTERACT_RANGE = 8;

/** Step-pad trigger: the ring plus the player's own radius (they overlap it). */
const STEP_PAD_RADIUS = RING_RADIUS + 0.5;
/** Leaving takes a little more, so hugging the edge doesn't fire repeatedly. */
const STEP_PAD_RELEASE = STEP_PAD_RADIUS + 0.5;
/**
 * How far above/below a stand's base your feet may be and still be *on* the pad.
 * Deliberately tight: the pad is the ring on the ground, so jumping lifts you off
 * it (the jump apex is ~2.4, far above this) and landing back inside counts as a
 * fresh entry — which is how a stand is pressed twice in the same spot. The
 * slightly larger release keeps uneven ground from flickering the pad off.
 */
const STEP_PAD_BAND = 0.4;
const STEP_PAD_BAND_RELEASE = 0.7;

/**
 * How often this client reports its body and its crate pushes to the session.
 * Fast enough that a crate follows your hands and a growing arm knows where you
 * are standing; slow enough to be nothing on the wire.
 */
const REPORT_MS = 50;

/** Default spawn (classic levels); Skyway levels override it via `terrain.spawn`. */
const DEFAULT_SPAWN = { x: 0, z: 22 };

type LevelBuildState = {
  presses: Record<string, number>;
  history: string[];
  phase: number;
  /** The session's crates and arms, so a level never builds with stale ones. */
  terrain: TerrainSnapshot | null;
};

export class GameController {
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private player: Player;
  private remote: RemotePlayer | null = null;
  private field: CrystalField | null = null;
  private terrain: Terrain | null = null;
  /** Whether the level just left had platforms (drives the respawn on load). */
  private wasPlatformer = false;
  /**
   * Platformer levels swap clicking for step pads: a generator fires when the
   * player walks into the glow ring at its base.
   */
  private stepPads = false;
  /**
   * Platformer levels also balance themselves: the moment the sides match the
   * ceremony fires on its own, so there is no Balance button (and no Undo —
   * taking a press back is not well defined once *reaching* a generator, and the
   * order you reach them in, is part of the puzzle).
   */
  private autoBalance = false;
  /** Guards against firing the automatic balance twice for one match. */
  private autoBalanceSent = false;
  /** Generator ids the player is currently standing in the ring of. */
  private onPad = new Set<string>();
  private stands: GeneratorStand[] = [];
  private levelGroup = new THREE.Group();
  private hud: Hud;
  private tutorial: Tutorial;
  private guides: Guides;
  private walkthrough: Walkthrough;
  private myBalances = 0;
  private level: LevelDef | null = null;
  /** Current cycle phase (0 for Sunset levels); drives the active side. */
  private phase = 0;
  /** Target level captured while the previous one's generators sink away. */
  private pendingLevel: { index: number; state: LevelBuildState } | null = null;
  private lastPresses: Record<string, number> = {};
  /** The press history behind `lastPresses`; kept so a hot-seat swap can re-ask
   * whose undo is available without waiting for the next state message. */
  private lastHistory: string[] = [];
  private busy = false; // balance animation in flight
  private disposed = false;
  /** Whether the loop should keep running (false while blurred / tab hidden). */
  private running = false;
  /** Whether a frame is already queued; guards against double-scheduling. */
  private scheduled = false;
  /** performance.now() of the last rendered frame, for the FPS cap. */
  private lastRender = 0;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerActive = false;
  private lastTime = 0;
  private poseTimer: number | undefined;
  private closeDialog: (() => void) | null = null;
  private iResetLast = false;
  private intro: IntroSequence | null = null;
  private pendingIntroToast: string | null = null;
  private crosshair: HTMLElement;

  /** `introPack` names the pack to welcome the player into; omit to skip the cutscene. */
  constructor(
    private channel: GameChannel,
    private onQuit: () => void,
    private packId: string,
    startLevel = 1,
    private onLevelComplete?: (levelIndex: number) => void,
    introPack?: string
  ) {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: getSettings().quality === 'high' });
    this.renderer.setPixelRatio(pixelRatioFor(getSettings()));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = getSettings().quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.camera.position.set(0, 8, 36);

    this.world = new World(WORLD_SEED);
    this.world.scene.add(this.levelGroup);

    this.player = new Player(channel.role, this.camera, this.world.heightAt, canvas);
    this.world.scene.add(this.player.mesh);

    if (channel.role === 'day' || channel.role === 'night') {
      this.remote = new RemotePlayer(channel.role === 'day' ? 'night' : 'day', this.world.heightAt);
      this.world.scene.add(this.remote.mesh);
    }
    // Every mode reports upstream, not just the networked one: the pose is how
    // the session knows where a body is standing (so an arm doesn't grow through
    // it), and a push is this client asking for a crate to move. In single
    // player the session is the loopback channel's own, so this is a call, not a
    // packet.
    this.poseTimer = window.setInterval(() => {
      this.channel.send({ t: 'pose', pose: this.player.getPose() });
      const pushes = this.terrain?.takePushes();
      if (pushes) this.channel.send({ t: 'push', pushes });
    }, REPORT_MS);

    this.tutorial = new Tutorial(channel.role);
    this.hud = new Hud(
      channel.role,
      () => this.requestBalance(),
      () => this.requestPass(),
      () => this.requestUndo(),
      () => this.requestReset(),
      () => this.quit()
    );
    uiRoot().append(this.hud.root);

    this.guides = new Guides({
      watch: () => ({
        usedKeys: this.player.usedKeys,
        heldKeys: this.player.heldKeys,
        turned: this.player.turned,
        balances: this.myBalances,
      }),
      balanceButton: this.hud.balanceButton,
    });
    uiRoot().append(this.guides.root);

    this.walkthrough = new Walkthrough({
      standAnchor: (id) => this.standAnchor(id),
      primaryButton: this.hud.balanceButton,
    });
    this.walkthrough.setWatch(() => ({ presses: this.lastPresses, phase: this.phase }));
    uiRoot().append(this.walkthrough.root);

    this.crosshair = el('div', { className: 'crosshair' });
    uiRoot().append(this.crosshair);

    channel.onMessage = (msg) => this.onMessage(msg);

    window.addEventListener('resize', this.onResize);
    // Fully pause rendering when the window loses focus or the tab is hidden —
    // no reason to heat up the GPU on a scene nobody is looking at.
    window.addEventListener('blur', this.pause);
    window.addEventListener('focus', this.resume);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mouseleave', this.onMouseLeave);
    // Suppress the native right-click menu anywhere in the level — including over
    // the win dialog and other DOM overlays, which sit above the canvas and so
    // would otherwise pop the menu (stealing focus and stalling key input).
    document.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    if (channel.swap) window.addEventListener('keydown', this.onKeyDown);

    // Debug/test handle for driving the game programmatically.
    (window as unknown as { __nd?: GameController }).__nd = this;

    if (introPack !== undefined) this.startIntro(introPack);

    this.tutorial.onGameStart();
    this.loadLevel(startLevel, { presses: {}, history: [], phase: 0, terrain: null });
    this.resume();

    if (channel.swap) showToast('Two-player test: press P to swap between ☀ Day and 🌙 Night.', 8);
  }

  // ---------- Pack intro cutscene ----------

  private startIntro(packName: string): void {
    // Everything that would talk over the cutscene waits for it to end.
    this.tutorial.setPaused(true);
    this.guides.setPaused(true);
    this.walkthrough.setPaused(true);
    this.hud.root.style.display = 'none';
    this.player.cameraEnabled = false;
    this.player.controlsEnabled = false;

    this.intro = new IntroSequence({
      scene: this.world.scene,
      camera: this.camera,
      packName,
      chasePose: () => this.player.cameraPose(),
      onControlsUnlocked: () => {
        this.player.controlsEnabled = true;
      },
      onFinish: () => this.endIntro(),
    });
  }

  private endIntro(): void {
    if (!this.intro) return;
    this.intro = null;
    this.player.cameraEnabled = true;
    this.player.controlsEnabled = true;
    this.player.snapCamera();
    this.hud.root.style.display = '';
    // The level asked for the cursor while the cutscene held the controls.
    if (cameraMode() === 'pointerlock') this.lockPointer();
    // Order matches a normal level start: tips start flowing, then the level's
    // own intro takes the screen (a toast replaces whatever is showing) and the
    // remaining tips queue up behind it.
    this.tutorial.setPaused(false);
    this.guides.setPaused(false);
    this.walkthrough.setPaused(false);
    if (this.pendingIntroToast) {
      showToast(this.pendingIntroToast, 9);
      this.pendingIntroToast = null;
    }
  }

  /** Test/debug hook: end the cutscene immediately (same as the Skip button). */
  skipIntro(): void {
    this.intro?.skip();
  }

  // ---------- Level lifecycle ----------

  private loadLevel(index: number, state: LevelBuildState): void {
    // Moving between levels: sink the current generators into the ground first,
    // then build the new level and let its generators rise. On the very first
    // load there is nothing to sink, so build straight away.
    if (this.stands.length > 0) {
      this.busy = true;
      this.player.setColliders([]);
      // Old geometry goes with the old generators, so nothing from the previous
      // level is left standing while the next one rises.
      this.player.setTerrain(null);
      this.terrain?.dispose();
      this.terrain = null;
      this.pendingLevel = { index, state };
      const old = this.stands;
      this.stands = [];
      let remaining = old.length;
      old.forEach((stand, i) =>
        stand.sinkOut(i * 0.06, () => {
          if (--remaining === 0 && this.pendingLevel) {
            const p = this.pendingLevel;
            this.pendingLevel = null;
            // A real level-to-level change: cross-fade the sky into the new
            // level's mood as its generators rise (first load snaps instead).
            this.buildLevel(p.index, p.state, true);
          }
        })
      );
    } else if (this.pendingLevel) {
      // A fresh state arrived while the old generators are still sinking; the
      // running sink will build this newer target when it finishes.
      this.pendingLevel = { index, state };
    } else {
      this.buildLevel(index, state);
    }
  }

  private buildLevel(index: number, state: LevelBuildState, animateAtmo = false): void {
    this.level = getLevel(this.packId, index);
    this.lastPresses = { ...state.presses };
    this.lastHistory = [...state.history];
    this.phase = state.phase;
    this.busy = false;

    // Move the atmosphere to this level's starting mood. On the first load there
    // is nothing to fade from so we snap; moving between levels cross-fades.
    const mode = this.atmosphereFor();
    this.world.setAtmosphere(mode, animateAtmo);

    this.levelGroup.clear();
    clearTweens();
    this.field = new CrystalField(this.level, this.world.heightAt);
    this.field.setAtmosphere(mode, animateAtmo);
    this.levelGroup.add(this.field.group);

    // Platforms and crates go up before the generators do, so a stand that
    // stands on one has its ground already there to rise out of.
    this.terrain = new Terrain(this.level.terrain, this.world.heightAt);
    this.levelGroup.add(this.terrain.group);
    this.player.setTerrain(this.terrain.isPlatformer ? this.terrain : null);
    // …and the other way round: a growing platform shoves whoever is in its way.
    this.terrain.setPlayer(this.player);
    // Classic levels share one open field, so the player keeps walking from
    // where they were. Platformer levels have hand-built geometry that the old
    // position could be standing inside, so those (and the level after one) put
    // the player back on the start mark.
    if (this.terrain.isPlatformer || this.wasPlatformer) {
      const spawn = this.level.terrain?.spawn ?? DEFAULT_SPAWN;
      const lane = this.channel.role === 'night' ? 3 : -3;
      this.player.placeAt(spawn.x + lane, spawn.z);
    }
    this.wasPlatformer = this.terrain.isPlatformer;
    // Platformer levels are the step-pad ones: you reach a generator with your
    // feet, so using it is walking into it rather than clicking it.
    this.stepPads = this.terrain.isPlatformer;
    // …and the ones that weigh themselves: with pushable crates and growing
    // platforms in play, "the sides match" is a moment you can walk into, so the
    // game notices it for you instead of asking for a button press.
    this.autoBalance = this.terrain.isPlatformer;
    // Platformer levels are played cursor-locked: the mouse only steers, so grab
    // the pointer as the level comes up. Esc gives it back (and the browser will
    // refuse a lock we ask for without a click — a click re-takes it).
    setCameraModeOverride(this.terrain.isPlatformer ? 'pointerlock' : null);
    if (this.terrain.isPlatformer) this.lockPointer();
    this.autoBalanceSent = false;
    this.hud.setAutoBalance(this.autoBalance);
    this.onPad.clear();

    this.stands = buildGenerators(this.level, this.world.heightAt);
    this.stands.forEach((stand, i) => {
      this.levelGroup.add(stand.root);
      stand.riseIn(i * 0.08); // rise out of the ground, cage/sign appearing after
    });
    this.refreshActiveStands();
    // Collisions turn on with the pedestals; crystals stay pass-through. The
    // `y` keeps a stand up on a platform from walling off the ground beneath it.
    this.player.setColliders(
      this.stands.map((s) => ({
        x: s.root.position.x,
        z: s.root.position.z,
        y: s.root.position.y,
        radius: PEDESTAL_COLLIDER_RADIUS,
      }))
    );

    this.hud.setLevel(this.level);
    this.hud.setTurn(this.level, this.makeState(state.presses, state.history));
    const counts = currentCounts(this.level, state.presses);
    this.field.setCounts(counts);
    // A platform whose condition already holds at level start is simply out.
    this.terrain.setCounts(counts, false);
    // …and if the session has already been playing this level (a peer joining
    // mid-level, or a reset landing), its crates and arms win over the authored
    // ones straight away.
    if (state.terrain) this.terrain.applySnapshot(state.terrain);
    this.hud.setCounts(counts);
    this.updateUndoAvailability(state.history);
    this.walkthrough.setLevel(this.level);

    // Skip the level's own intro toast for a player still meeting the mechanics
    // (goal tip unseen): the guidance covers orientation and the toast would
    // otherwise clobber the first tip. Returning players get the level flavor.
    const firstTime = !hasSeenMechanic('goal');
    if (this.level.intro && !firstTime) {
      if (this.intro) this.pendingIntroToast = this.level.intro;
      else showToast(this.level.intro, 9);
    }
    this.tutorial.onLevelWithGenerators();
    if (this.stepPads) this.tutorial.onFirstStepPad();
    if ((this.level.terrain?.platforms.length ?? 0) > 0) this.tutorial.onFirstPlatforms();
    if ((this.level.terrain?.boxes.length ?? 0) > 0) this.tutorial.onFirstCrate();
    if (this.terrain.hasExtenders) this.tutorial.onFirstExtender();
    if (this.level.generators.some((g) => g.outputs.length > 1 || g.outputs[0].count > 1)) {
      this.tutorial.onFirstMultiOutput();
    }
  }

  /** Build a full GameState from the pieces the controller tracks. */
  private makeState(presses: Record<string, number>, history: string[]): GameState {
    return {
      packId: this.packId,
      levelIndex: this.level?.index ?? 1,
      presses,
      history,
      phase: this.phase,
      resets: 0,
      hintTaken: false,
      solved: false,
      terrain: null,
    };
  }

  /** The side allowed to act right now (null on Sunset levels — both sides). */
  private currentActiveSide(): Side | null {
    if (!this.level) return null;
    return activeSide(this.level, this.makeState(this.lastPresses, []));
  }

  /** Atmosphere this level should show at the current phase. */
  private atmosphereFor(): Atmosphere {
    if (!this.level || !isCycle(this.level)) return 'sunset';
    return this.currentActiveSide() as Atmosphere;
  }

  /** Light up the active side's generators and dim the resting side's. */
  private refreshActiveStands(): void {
    const active = this.currentActiveSide();
    for (const s of this.stands) s.setActive(active === null || s.def.side === active);
  }

  private applyState(state: GameState): void {
    if (!this.level || state.levelIndex !== this.level.index) {
      this.closeDialog?.();
      this.closeDialog = null;
      this.loadLevel(state.levelIndex, state);
      return;
    }
    // Which generator changed? Its crown scaffolds are where the new crystals
    // materialize before flying to the rings.
    let spawnPoints: SpawnPoint[] | undefined;
    for (const stand of this.stands) {
      const before = this.lastPresses[stand.def.id] ?? 0;
      const after = state.presses[stand.def.id] ?? 0;
      if (after > before) {
        spawnPoints = [...(spawnPoints ?? []), ...stand.getSpawnPoints()];
        stand.pulse();
      }
    }
    const wasReset = Object.keys(state.presses).length === 0 && Object.keys(this.lastPresses).length > 0;
    const phaseChanged = state.phase !== this.phase;
    this.phase = state.phase;
    this.lastPresses = { ...state.presses };
    this.lastHistory = [...state.history];
    const counts = currentCounts(this.level, state.presses);
    this.field?.setCounts(counts, spawnPoints);
    // Extending platforms are pure functions of the counts, so reaching out and
    // pulling back in needs nothing more than this — in either play mode.
    this.terrain?.setCounts(counts);
    // Every state message carries the session's crates and arms — a reset puts
    // them back on their marks this way too.
    if (state.terrain) this.terrain?.applySnapshot(state.terrain);
    this.hud.setCounts(counts);
    this.updateUndoAvailability(state.history);

    // A pass (or reset back to phase 0) changes whose turn it is: cross-fade the
    // atmosphere, relight the active side, and retarget the primary button.
    if (phaseChanged) {
      const mode = this.atmosphereFor();
      this.world.setAtmosphere(mode, true);
      this.field?.setAtmosphere(mode, true);
    }
    this.refreshActiveStands();
    this.hud.setTurn(this.level, state);

    const balanced = Object.values(counts).every((c) => c.day === c.night);
    if (balanced && !state.solved && !this.autoBalance) this.tutorial.onFirstBalanceReady();
    // Platformer levels weigh themselves the instant the sides match. On cycle
    // levels the turn still has to be handed off first, so wait for the phase
    // where Balance would have been available.
    if (this.autoBalance && balanced && !state.solved && !canPass(this.level, state)) {
      if (!this.autoBalanceSent) {
        this.autoBalanceSent = true;
        this.requestBalance();
      }
    } else {
      this.autoBalanceSent = false;
    }

    if (wasReset && this.iResetLast) {
      this.iResetLast = false;
      this.offerHint();
    }
  }

  /** Undo is offered whenever this player has a press of their own to take back. */
  private updateUndoAvailability(history: string[]): void {
    this.hud.setCanUndo(
      this.level !== null &&
        undoIndexFor(this.level, this.channel.role, history, this.makeState(this.lastPresses, history)) >= 0
    );
  }

  // ---------- Player actions ----------

  private requestBalance(): void {
    if (this.busy) return;
    this.myBalances++;
    this.channel.send({ t: 'balance' });
  }

  private requestPass(): void {
    if (this.busy) return;
    this.channel.send({ t: 'pass' });
  }

  /**
   * Generators this player may press right now: their own side (Dusk owns both),
   * and — on Cycle levels — only while that side is the active one.
   */
  private canPress(stand: GeneratorStand): boolean {
    const mine = this.channel.role === 'dusk' || this.channel.role === stand.def.side;
    if (!mine) return false;
    const active = this.currentActiveSide();
    return active === null || stand.def.side === active;
  }

  /** Screen position of a specific generator (for the tutorial walkthrough). */
  private standAnchor(genId: string): { x: number; y: number } | null {
    const stand = this.stands.find((s) => s.def.id === genId);
    if (!stand) return null;
    const at = stand.root.position.clone().setY(stand.root.position.y + 2.4).project(this.camera);
    if (at.z > 1 || Math.abs(at.x) > 1 || Math.abs(at.y) > 1) return null;
    return {
      x: ((at.x + 1) / 2) * window.innerWidth,
      y: ((1 - at.y) / 2) * window.innerHeight,
    };
  }

  private requestUndo(): void {
    if (this.busy) return;
    this.channel.send({ t: 'undo' });
  }

  private requestReset(): void {
    if (this.busy) return;
    this.iResetLast = true;
    this.channel.send({ t: 'reset' });
  }

  private offerHint(): void {
    this.closeDialog?.();
    this.closeDialog = showDialog({
      message: 'Would you like a hint?',
      buttons: [
        { label: 'Yes, please!', onClick: () => this.channel.send({ t: 'hint' }) },
        { label: 'No, I want to solve it', onClick: () => {} },
      ],
    });
  }

  private onMouseMove = (event: MouseEvent): void => {
    this.pointer.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1
    );
    this.pointerActive = true;
  };

  private onMouseLeave = (): void => {
    this.pointerActive = false;
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  /** P hands the keyboard to the other player, on a hot-seat channel only. */
  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== 'KeyP' || e.repeat) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    this.swapPlayers();
  };

  /**
   * Hot seat (the editor's two-player play test): take over the other character
   * where it stands, leaving the one you were playing exactly where you left it.
   * It is the same two bodies the networked game has — only now one keyboard
   * drives them in turn, so a level can be tested the way two players meet it.
   */
  private swapPlayers(): void {
    if (!this.channel.swap || !this.remote || this.busy || this.intro) return;
    const mine = this.player.getPose();
    const theirs = this.remote.mesh.position.clone();
    const theirYaw = this.remote.mesh.rotation.y;

    const role = this.channel.swap();
    this.player.setRole(role);
    this.player.placeAt(theirs.x, theirs.z);
    this.player.yaw = theirYaw;
    this.player.snapCamera();
    this.remote.setRole(role === 'day' ? 'night' : 'day');
    this.remote.snapTo(mine);

    // Arm whatever pad the character we took over is already standing in, so
    // stepping into their shoes never fires a free press.
    this.onPad.clear();
    for (const stand of this.stands) {
      if (this.inPadRange(stand, false)) this.onPad.add(stand.def.id);
    }

    this.hud.setRole(role);
    if (this.level) this.hud.setTurn(this.level, this.makeState(this.lastPresses, this.lastHistory));
    this.updateUndoAvailability(this.lastHistory);
    this.refreshActiveStands();
    showToast(
      role === 'day' ? 'You are ☀ Day now — press P to swap back.' : 'You are 🌙 Night now — press P to swap back.',
      3
    );
  }

  private onPointerLockChange = (): void => {
    this.crosshair.classList.toggle('visible', this.isPointerLocked());
  };

  /**
   * Going full screen re-takes the cursor: Esc is the one key that gets it back,
   * and it drops full screen at the same time, so ⛶ is the natural way back in.
   */
  private onFullscreenChange = (): void => {
    if (document.fullscreenElement && cameraMode() === 'pointerlock') this.lockPointer();
  };

  private lockPointer(): void {
    if (this.disposed || this.intro || this.isPointerLocked()) return;
    // Rejects when the browser wants a user gesture first — clicking the scene
    // is always the fallback, so a refusal here is nothing to report.
    void this.renderer.domElement.requestPointerLock()?.catch(() => {});
  }

  private isPointerLocked(): boolean {
    return document.pointerLockElement === this.renderer.domElement;
  }

  /**
   * Outline the generator the player is "on": the one under the pointer on
   * classic levels, or the one whose ring they are standing in on platformer
   * levels (where the pointer means nothing).
   */
  private updateHover(): void {
    let hovered: GeneratorStand | null = null;
    if (this.stepPads) {
      for (const stand of this.stands) {
        if (!stand.isSolid() || !stand.isActive()) continue;
        if (this.onPad.has(stand.def.id)) {
          hovered = stand;
          break;
        }
      }
      for (const stand of this.stands) stand.setHovered(stand === hovered);
      this.renderer.domElement.style.cursor = '';
      return;
    }
    const locked = this.isPointerLocked();
    if ((locked || this.pointerActive) && this.level && !this.busy && !this.intro) {
      const ndc = locked ? new THREE.Vector2(0, 0) : this.pointer;
      this.raycaster.setFromCamera(ndc, this.camera);
      for (const stand of this.stands) {
        if (!stand.isSolid() || !stand.isActive()) continue;
        if (this.raycaster.intersectObjects(stand.clickTargets, false).length > 0) {
          hovered = stand;
          break;
        }
      }
    }
    for (const stand of this.stands) stand.setHovered(stand === hovered);
    this.renderer.domElement.style.cursor = hovered ? 'pointer' : '';
  }

  private onClick = (event: MouseEvent): void => {
    if (this.busy || !this.level || this.intro) return;
    // Platformer levels have no clickable generators at all — you step into the
    // ring instead (see `updateStepPads`).
    if (this.stepPads) return;
    const locked = this.isPointerLocked();
    // In pointer-lock mode, the first click only engages the cursor lock
    // (requested by Player's mousedown handler) — it isn't a game action yet.
    if (cameraMode() === 'pointerlock' && !locked) return;
    const ndc = locked
      ? new THREE.Vector2(0, 0)
      : new THREE.Vector2(
          (event.clientX / window.innerWidth) * 2 - 1,
          -(event.clientY / window.innerHeight) * 2 + 1
        );
    this.raycaster.setFromCamera(ndc, this.camera);
    for (const stand of this.stands) {
      // Dimmed (inactive-side, cycle) stands are not clickable at all.
      if (!stand.isSolid() || !stand.isActive()) continue;
      const hits = this.raycaster.intersectObjects(stand.clickTargets, false);
      if (hits.length === 0) continue;
      const dist = stand.root.position.distanceTo(this.player.mesh.position);
      if (dist > INTERACT_RANGE) {
        showToast('Walk closer to the generator to use it!', 3);
        return;
      }
      this.attemptPress(stand);
      return;
    }
  };

  /**
   * Send a press for `stand`, or explain (and flash it) if this player may not
   * use it right now. Shared by clicking (classic levels) and stepping into the
   * ring (platformer levels).
   */
  private attemptPress(stand: GeneratorStand): void {
    if (!this.canPress(stand)) {
      stand.deny();
      const active = this.currentActiveSide();
      if (active !== null) {
        // Cycle level, wrong turn: gentle "wait your turn" nudge.
        showToast(`It's ${active === 'day' ? 'Day' : 'Night'}'s turn right now — hold on!`, 4);
      } else {
        showToast(
          this.channel.role === 'day'
            ? 'That is a night generator — only Night can press it. Team up!'
            : 'That is a day generator — only Day can press it. Team up!',
          4
        );
      }
      return;
    }
    // The Balance coach mark waits for a first press — but only where there is a
    // Balance button to point at (auto-balance levels have none).
    if (!this.level?.tutorial && !this.autoBalance) this.guides.unlock('balance');
    this.channel.send({ t: 'press', gen: stand.def.id });
  }

  /**
   * Platformer levels: a generator fires when the player walks into the glow
   * ring at its base. It fires once per entry — you have to step back out (past
   * a slightly wider ring, so brushing the edge doesn't stutter) before it can
   * fire again. The pedestal collider stops the player at 1.6 from the centre,
   * which is comfortably inside the trigger, so walking up to a stand always
   * counts.
   */
  private updateStepPads(): void {
    if (!this.stepPads || !this.level) return;
    for (const stand of this.stands) {
      const was = this.onPad.has(stand.def.id);
      const inside = this.inPadRange(stand, was);
      if (inside === was) continue;
      if (inside) {
        this.onPad.add(stand.def.id);
        // Sinking/rising stands and paused moments (intro, balance animation)
        // arm the pad but don't fire it.
        if (stand.isSolid() && !this.busy && !this.intro) this.attemptPress(stand);
      } else {
        this.onPad.delete(stand.def.id);
      }
    }
  }

  /**
   * Is the player standing in this stand's glow ring — feet and all? `already`
   * widens both the ring and the height band a little, so hugging the edge of a
   * pad you are on doesn't stutter.
   */
  private inPadRange(stand: GeneratorStand, already: boolean): boolean {
    const p = this.player.mesh.position;
    // Your feet have to be at the base of the stand: a stand on a platform must
    // not fire from the ground underneath it, and jumping lifts you off the pad.
    const band = already ? STEP_PAD_BAND_RELEASE : STEP_PAD_BAND;
    if (Math.abs(this.player.feetHeight - stand.root.position.y) > band) return false;
    const dist = Math.hypot(p.x - stand.root.position.x, p.z - stand.root.position.z);
    return dist <= (already ? STEP_PAD_RELEASE : STEP_PAD_RADIUS);
  }

  // ---------- Server messages ----------

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case 'state':
        this.applyState(msg.state);
        break;
      case 'balance-result': {
        if (!this.field || !this.level) break;
        this.busy = true;
        this.hud.setBusy(true);
        dismissToast();
        const level = this.level;
        playBalanceAnimation(this.world.scene, this.field, () => {
          this.busy = false;
          this.hud.setBusy(false);
          if (msg.win) {
            this.onLevelComplete?.(level.index);
            this.showWinDialog(level);
          } else {
            // Crystals return to their original positions; play continues.
            this.field?.restoreSlots();
            showToast('Not balanced yet — some crystals were left over. Keep trying!', 4);
          }
          this.applyState(msg.state);
        });
        break;
      }
      case 'hint': {
        if (!this.level) break;
        const label = generatorLabel(this.level, msg.gen);
        showDialog({
          message: `Here is a nudge:\nTry ending up with the ${label} pressed ${msg.presses} time${msg.presses === 1 ? '' : 's'} in total.`,
          buttons: [{ label: 'Got it!', onClick: () => {} }],
        });
        break;
      }
      case 'offer-answer': {
        this.closeDialog?.();
        this.closeDialog = showDialog({
          message: 'Would you like to see the answer?',
          buttons: [
            { label: 'Yes, show me', onClick: () => this.channel.send({ t: 'answer' }) },
            { label: 'Not yet', onClick: () => {} },
          ],
        });
        break;
      }
      case 'answer': {
        if (!this.level) break;
        const lines = this.level.generators
          .map((g) => `• ${generatorLabel(this.level!, g.id)}: press ${msg.solution[g.id] ?? 0} time${(msg.solution[g.id] ?? 0) === 1 ? '' : 's'}`)
          .join('\n');
        showDialog({
          title: 'The Answer',
          message: `${lines}\n\nReset first, then press exactly these amounts and hit Balance.`,
          buttons: [{ label: 'OK', onClick: () => {} }],
        });
        break;
      }
      case 'pose':
        this.remote?.applyPose(msg.pose);
        // The peer is a body an arm has to reckon with here too, so our
        // prediction pauses a platform for them just as the session does.
        this.terrain?.setPeer(bodyFromPose(msg.pose));
        break;
      case 'terrain':
        // The authoritative crates and arms. Whatever we predicted since the
        // last one slides into place rather than jumping (see `applySnapshot`).
        this.terrain?.applySnapshot(msg.terrain);
        break;
      case 'peer-left':
        showDialog({
          message: 'The other player left the game.',
          buttons: [{ label: 'Back to menu', onClick: () => this.quit() }],
        });
        break;
      case 'error':
        showToast(msg.message, 4);
        break;
      default:
        break;
    }
  }

  private showWinDialog(level: LevelDef): void {
    const last = level.index >= levelCount(this.packId);
    this.closeDialog?.();
    this.closeDialog = showDialog({
      title: last ? 'Pack Complete!' : 'You Win!',
      message: last
        ? `Perfect balance! You finished every level of the ${getPack(this.packId).name}. The sun and the stars thank you!`
        : `Level ${level.index} balanced perfectly!`,
      winStyle: true,
      buttons: last
        ? [{ label: 'Back to menu', onClick: () => this.quit() }]
        : [{ label: 'Next level →', onClick: () => this.channel.send({ t: 'next' }) }],
    });
  }

  // ---------- Loop & teardown ----------

  /** Queue the next frame, unless one is already queued or the loop is stopped. */
  private ensureScheduled(): void {
    if (this.scheduled || !this.running || this.disposed) return;
    this.scheduled = true;
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.scheduled = false;
    if (this.disposed || !this.running) return;
    this.ensureScheduled();

    // Frame-rate cap: skip the update + render entirely when we're ahead of the
    // ceiling. rAF keeps firing (cheap), but we do no work — and skipping
    // render() also skips the shadow-map pass, so this cuts both CPU and GPU.
    const cap = getSettings().fpsCap;
    if (cap > 0 && now - this.lastRender < 1000 / cap - 1) return;
    this.lastRender = now;

    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    // Single player hosts the session in this tab, so its clock is our clock.
    // (In a room the server runs it and its updates arrive as messages.)
    this.channel.tick?.(dt);
    // Crates settle before the player moves, so the surface under their feet is
    // this frame's, not last frame's.
    this.terrain?.update(dt);
    this.player.update(dt);
    this.remote?.update(dt);
    this.field?.update(dt);
    this.world.update(dt, this.player.mesh.position);
    for (const stand of this.stands) stand.update(dt, this.camera);
    this.intro?.update();
    this.updateStepPads();
    this.updateHover();
    this.guides.update();
    this.walkthrough.update();
    updateTweens(dt);
    this.renderer.render(this.world.scene, this.camera);
  };

  /** Stop the render loop (window blurred / tab hidden / disposed). */
  private pause = (): void => {
    this.running = false;
  };

  /** (Re)start the render loop, resetting the clock so dt doesn't jump. */
  private resume = (): void => {
    if (this.disposed || this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.ensureScheduled();
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) this.pause();
    else this.resume();
  };

  /** Re-read the pixel ratio from settings (called live when the slider moves). */
  applyResolutionScale(): void {
    this.renderer.setPixelRatio(pixelRatioFor(getSettings()));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private quit(): void {
    this.dispose();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    this.onQuit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    this.intro?.dispose();
    this.intro = null;
    if (this.poseTimer !== undefined) window.clearInterval(this.poseTimer);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('blur', this.pause);
    window.removeEventListener('focus', this.resume);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer.domElement.removeEventListener('click', this.onClick);
    this.renderer.domElement.removeEventListener('mousemove', this.onMouseMove);
    this.renderer.domElement.removeEventListener('mouseleave', this.onMouseLeave);
    document.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    window.removeEventListener('keydown', this.onKeyDown);
    setCameraModeOverride(null);
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.crosshair.remove();
    this.renderer.domElement.style.cursor = '';
    this.terrain?.dispose();
    this.terrain = null;
    this.guides.dispose();
    this.walkthrough.dispose();
    this.player.dispose();
    this.channel.close();
    clearTweens();
    dismissToast();
    this.renderer.dispose();
  }
}

/**
 * The other player's body as the terrain model sees it: a footprint the size of
 * a character, standing at whatever height their last pose reported.
 */
function bodyFromPose(pose: PlayerPose): { pushBox: () => { x: number; z: number; feetY: number; half: number; height: number } } {
  const feetY = pose.y ?? pose.jump;
  return {
    pushBox: () => ({ x: pose.x, z: pose.z, feetY, half: PLAYER_RADIUS, height: ACTOR_HEIGHT }),
  };
}
