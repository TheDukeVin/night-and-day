// The in-game controller: owns the renderer/scene for a play session, loads
// levels, routes input to the game channel and reacts to authoritative state.

import * as THREE from 'three';
import { getLevel, LEVEL_COUNT } from '../../../shared/levels.ts';
import { currentCounts, generatorLabel, undoIndexFor } from '../../../shared/logic.ts';
import type { GameState, LevelDef, ServerMsg } from '../../../shared/types.ts';
import type { GameChannel } from '../net/client.ts';
import { getSettings } from '../settings.ts';
import { Hud } from '../screens/hud.ts';
import { dismissToast, el, showDialog, showToast, uiRoot } from '../screens/ui.ts';
import { clearTweens, updateTweens } from './anim.ts';
import { playBalanceAnimation } from './balance.ts';
import { CrystalField } from './crystals.ts';
import type { SpawnPoint } from './crystals.ts';
import { buildGenerators, GeneratorStand, PEDESTAL_COLLIDER_RADIUS } from './generators.ts';
import { Guides } from './guides.ts';
import { IntroSequence } from './intro.ts';
import { Player, RemotePlayer } from './player.ts';
import { hasSeenMechanic } from '../mechanics.ts';
import { Tutorial } from './tutorial.ts';
import { World } from './world.ts';

const INTERACT_RANGE = 8;

type LevelBuildState = { presses: Record<string, number>; history: string[] };

export class GameController {
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private player: Player;
  private remote: RemotePlayer | null = null;
  private field: CrystalField | null = null;
  private stands: GeneratorStand[] = [];
  private levelGroup = new THREE.Group();
  private hud: Hud;
  private tutorial: Tutorial;
  private guides: Guides;
  private myPresses = 0;
  private myBalances = 0;
  private level: LevelDef | null = null;
  /** Target level captured while the previous one's generators sink away. */
  private pendingLevel: { index: number; state: LevelBuildState } | null = null;
  private lastPresses: Record<string, number> = {};
  private busy = false; // balance animation in flight
  private disposed = false;
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
    startLevel = 1,
    private onLevelComplete?: (levelIndex: number) => void,
    introPack?: string
  ) {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: getSettings().quality === 'high' });
    this.renderer.setPixelRatio(getSettings().quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = getSettings().quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.camera.position.set(0, 8, 36);

    this.world = new World(20260719);
    this.world.scene.add(this.levelGroup);

    this.player = new Player(channel.role, this.camera, this.world.heightAt, canvas);
    this.world.scene.add(this.player.mesh);

    if (channel.role === 'day' || channel.role === 'night') {
      this.remote = new RemotePlayer(channel.role === 'day' ? 'night' : 'day', this.world.heightAt);
      this.world.scene.add(this.remote.mesh);
      this.poseTimer = window.setInterval(() => this.channel.send({ t: 'pose', pose: this.player.getPose() }), 100);
    }

    this.tutorial = new Tutorial(channel.role);
    this.hud = new Hud(
      channel.role,
      () => this.requestBalance(),
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
        presses: this.myPresses,
        balances: this.myBalances,
      }),
      pressAnchor: () => this.pressAnchor(),
      balanceButton: this.hud.balanceButton,
    });
    uiRoot().append(this.guides.root);

    this.crosshair = el('div', { className: 'crosshair' });
    uiRoot().append(this.crosshair);

    channel.onMessage = (msg) => this.onMessage(msg);

    window.addEventListener('resize', this.onResize);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mouseleave', this.onMouseLeave);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    // Debug/test handle for driving the game programmatically.
    (window as unknown as { __nd?: GameController }).__nd = this;

    if (introPack !== undefined) this.startIntro(introPack);

    this.tutorial.onGameStart();
    this.loadLevel(startLevel, { presses: {}, history: [] });
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ---------- Pack intro cutscene ----------

  private startIntro(packName: string): void {
    // Everything that would talk over the cutscene waits for it to end.
    this.tutorial.setPaused(true);
    this.guides.setPaused(true);
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
    // Order matches a normal level start: tips start flowing, then the level's
    // own intro takes the screen (a toast replaces whatever is showing) and the
    // remaining tips queue up behind it.
    this.tutorial.setPaused(false);
    this.guides.setPaused(false);
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
      this.pendingLevel = { index, state };
      const old = this.stands;
      this.stands = [];
      let remaining = old.length;
      old.forEach((stand, i) =>
        stand.sinkOut(i * 0.06, () => {
          if (--remaining === 0 && this.pendingLevel) {
            const p = this.pendingLevel;
            this.pendingLevel = null;
            this.buildLevel(p.index, p.state);
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

  private buildLevel(index: number, state: LevelBuildState): void {
    this.level = getLevel(index);
    this.lastPresses = { ...state.presses };
    this.busy = false;

    this.levelGroup.clear();
    clearTweens();
    this.field = new CrystalField(this.level, this.world.heightAt);
    this.levelGroup.add(this.field.group);
    this.stands = buildGenerators(this.level, this.world.heightAt);
    this.stands.forEach((stand, i) => {
      this.levelGroup.add(stand.root);
      stand.riseIn(i * 0.08); // rise out of the ground, cage/sign appearing after
    });
    // Collisions turn on with the pedestals; crystals stay pass-through.
    this.player.setColliders(
      this.stands.map((s) => ({ x: s.root.position.x, z: s.root.position.z, radius: PEDESTAL_COLLIDER_RADIUS }))
    );

    this.hud.setLevel(this.level);
    const counts = currentCounts(this.level, state.presses);
    this.field.setCounts(counts);
    this.hud.setCounts(counts);
    this.updateUndoAvailability(state.history);

    // Skip the level's own intro toast for a player still meeting the mechanics
    // (goal tip unseen): the guidance covers orientation and the toast would
    // otherwise clobber the first tip. Returning players get the level flavor.
    const firstTime = !hasSeenMechanic('goal');
    if (this.level.intro && !firstTime) {
      if (this.intro) this.pendingIntroToast = this.level.intro;
      else showToast(this.level.intro, 9);
    }
    if (this.stands.some((s) => this.canPress(s))) this.guides.unlock('press');
    this.tutorial.onLevelWithGenerators();
    if (this.level.generators.some((g) => g.outputs.length > 1 || g.outputs[0].count > 1)) {
      this.tutorial.onFirstMultiOutput();
    }
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
    this.lastPresses = { ...state.presses };
    const counts = currentCounts(this.level, state.presses);
    this.field?.setCounts(counts, spawnPoints);
    this.hud.setCounts(counts);
    this.updateUndoAvailability(state.history);

    const balanced = Object.values(counts).every((c) => c.day === c.night);
    if (balanced && !state.solved) this.tutorial.onFirstBalanceReady();

    if (wasReset && this.iResetLast) {
      this.iResetLast = false;
      this.offerHint();
    }
  }

  /** Undo is offered whenever this player has a press of their own to take back. */
  private updateUndoAvailability(history: string[]): void {
    this.hud.setCanUndo(
      this.level !== null && undoIndexFor(this.level, this.channel.role, history) >= 0
    );
  }

  // ---------- Player actions ----------

  private requestBalance(): void {
    if (this.busy) return;
    this.myBalances++;
    this.channel.send({ t: 'balance' });
  }

  /** Generators this player is allowed to press (Dusk may press any). */
  private canPress(stand: GeneratorStand): boolean {
    return this.channel.role === 'dusk' || this.channel.role === stand.def.side;
  }

  /**
   * Screen position of the generator the press guide points at: the nearest one
   * this player can use, or null while it is off-screen or behind the camera.
   */
  private pressAnchor(): { x: number; y: number } | null {
    let best: GeneratorStand | null = null;
    let bestDist = Infinity;
    for (const stand of this.stands) {
      if (!this.canPress(stand)) continue;
      const dist = stand.root.position.distanceTo(this.player.mesh.position);
      if (dist < bestDist) {
        bestDist = dist;
        best = stand;
      }
    }
    if (!best) return null;
    const at = best.root.position.clone().setY(best.root.position.y + 2.4).project(this.camera);
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

  private onPointerLockChange = (): void => {
    this.crosshair.classList.toggle('visible', this.isPointerLocked());
  };

  private isPointerLocked(): boolean {
    return document.pointerLockElement === this.renderer.domElement;
  }

  /** Raycast the pointer each frame and outline the hovered generator. */
  private updateHover(): void {
    let hovered: GeneratorStand | null = null;
    const locked = this.isPointerLocked();
    if ((locked || this.pointerActive) && this.level && !this.busy && !this.intro) {
      const ndc = locked ? new THREE.Vector2(0, 0) : this.pointer;
      this.raycaster.setFromCamera(ndc, this.camera);
      for (const stand of this.stands) {
        if (!stand.isSolid()) continue;
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
    const locked = this.isPointerLocked();
    // In pointer-lock mode, the first click only engages the cursor lock
    // (requested by Player's mousedown handler) — it isn't a game action yet.
    if (getSettings().cameraMode === 'pointerlock' && !locked) return;
    const ndc = locked
      ? new THREE.Vector2(0, 0)
      : new THREE.Vector2(
          (event.clientX / window.innerWidth) * 2 - 1,
          -(event.clientY / window.innerHeight) * 2 + 1
        );
    this.raycaster.setFromCamera(ndc, this.camera);
    for (const stand of this.stands) {
      if (!stand.isSolid()) continue;
      const hits = this.raycaster.intersectObjects(stand.clickTargets, false);
      if (hits.length === 0) continue;
      const dist = stand.root.position.distanceTo(this.player.mesh.position);
      if (dist > INTERACT_RANGE) {
        showToast('Walk closer to the generator to use it!', 3);
        return;
      }
      if (!this.canPress(stand)) {
        stand.deny();
        showToast(
          this.channel.role === 'day'
            ? 'That is a night generator — only Night can press it. Team up!'
            : 'That is a day generator — only Day can press it. Team up!',
          4
        );
        return;
      }
      this.myPresses++;
      this.guides.unlock('balance');
      this.channel.send({ t: 'press', gen: stand.def.id });
      return;
    }
  };

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
    const last = level.index >= LEVEL_COUNT;
    this.closeDialog?.();
    this.closeDialog = showDialog({
      title: last ? 'Pack Complete!' : 'You Win!',
      message: last
        ? 'Perfect balance! You finished every level of the Starter pack. The sun and the stars thank you!'
        : `Level ${level.index} balanced perfectly!`,
      winStyle: true,
      buttons: last
        ? [{ label: 'Back to menu', onClick: () => this.quit() }]
        : [{ label: 'Next level →', onClick: () => this.channel.send({ t: 'next' }) }],
    });
  }

  // ---------- Loop & teardown ----------

  private frame = (now: number): void => {
    if (this.disposed) return;
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.player.update(dt);
    this.remote?.update(dt);
    this.field?.update(dt);
    for (const stand of this.stands) stand.update(dt, this.camera);
    this.intro?.update();
    this.updateHover();
    this.guides.update();
    updateTweens(dt);
    this.renderer.render(this.world.scene, this.camera);
    requestAnimationFrame(this.frame);
  };

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
    this.intro?.dispose();
    this.intro = null;
    if (this.poseTimer !== undefined) window.clearInterval(this.poseTimer);
    window.removeEventListener('resize', this.onResize);
    this.renderer.domElement.removeEventListener('click', this.onClick);
    this.renderer.domElement.removeEventListener('mousemove', this.onMouseMove);
    this.renderer.domElement.removeEventListener('mouseleave', this.onMouseLeave);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.crosshair.remove();
    this.renderer.domElement.style.cursor = '';
    this.guides.dispose();
    this.player.dispose();
    this.channel.close();
    clearTweens();
    dismissToast();
    this.renderer.dispose();
  }
}
