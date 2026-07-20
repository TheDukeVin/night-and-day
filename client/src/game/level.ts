// The in-game controller: owns the renderer/scene for a play session, loads
// levels, routes input to the game channel and reacts to authoritative state.

import * as THREE from 'three';
import { getLevel, LEVEL_COUNT } from '../../../shared/levels.ts';
import { currentCounts, generatorLabel } from '../../../shared/logic.ts';
import type { GameState, LevelDef, ServerMsg } from '../../../shared/types.ts';
import type { GameChannel } from '../net/client.ts';
import { getSettings } from '../settings.ts';
import { Hud } from '../screens/hud.ts';
import { dismissToast, el, showDialog, showToast, uiRoot } from '../screens/ui.ts';
import { clearTweens, updateTweens } from './anim.ts';
import { playBalanceAnimation } from './balance.ts';
import { CrystalField } from './crystals.ts';
import type { SpawnPoint } from './crystals.ts';
import { buildGenerators, GeneratorStand } from './generators.ts';
import { Player, RemotePlayer } from './player.ts';
import { Tutorial } from './tutorial.ts';
import { World } from './world.ts';

const INTERACT_RANGE = 8;

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
  private level: LevelDef | null = null;
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
  private crosshair: HTMLElement;

  constructor(
    private channel: GameChannel,
    private onQuit: () => void,
    startLevel = 1
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
      () => this.requestReset(),
      () => this.quit()
    );
    uiRoot().append(this.hud.root);

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

    this.tutorial.onGameStart();
    this.loadLevel(startLevel, { presses: {} });
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ---------- Level lifecycle ----------

  private loadLevel(index: number, state: { presses: Record<string, number> }): void {
    this.level = getLevel(index);
    this.lastPresses = { ...state.presses };
    this.busy = false;

    this.levelGroup.clear();
    clearTweens();
    this.field = new CrystalField(this.level, this.world.heightAt);
    this.levelGroup.add(this.field.group);
    this.stands = buildGenerators(this.level, this.world.heightAt);
    for (const stand of this.stands) this.levelGroup.add(stand.root);

    this.hud.setLevel(this.level);
    const counts = currentCounts(this.level, state.presses);
    this.field.setCounts(counts);
    this.hud.setCounts(counts);

    if (this.level.intro) showToast(this.level.intro, 9);
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

    const balanced = Object.values(counts).every((c) => c.day === c.night);
    if (balanced && !state.solved) this.tutorial.onFirstBalanceReady();

    if (wasReset && this.iResetLast) {
      this.iResetLast = false;
      this.offerHint();
    }
  }

  // ---------- Player actions ----------

  private requestBalance(): void {
    if (this.busy) return;
    this.channel.send({ t: 'balance' });
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
    if ((locked || this.pointerActive) && this.level && !this.busy) {
      const ndc = locked ? new THREE.Vector2(0, 0) : this.pointer;
      this.raycaster.setFromCamera(ndc, this.camera);
      for (const stand of this.stands) {
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
    if (this.busy || !this.level) return;
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
      const hits = this.raycaster.intersectObjects(stand.clickTargets, false);
      if (hits.length === 0) continue;
      const dist = stand.root.position.distanceTo(this.player.mesh.position);
      if (dist > INTERACT_RANGE) {
        showToast('Walk closer to the generator to use it!', 3);
        return;
      }
      const mine = this.channel.role === 'dusk' || this.channel.role === stand.def.side;
      if (!mine) {
        stand.deny();
        showToast(
          this.channel.role === 'day'
            ? 'That is a night generator — only Night can press it. Team up!'
            : 'That is a day generator — only Day can press it. Team up!',
          4
        );
        return;
      }
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
    for (const stand of this.stands) stand.update(dt);
    this.updateHover();
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
    if (this.poseTimer !== undefined) window.clearInterval(this.poseTimer);
    window.removeEventListener('resize', this.onResize);
    this.renderer.domElement.removeEventListener('click', this.onClick);
    this.renderer.domElement.removeEventListener('mousemove', this.onMouseMove);
    this.renderer.domElement.removeEventListener('mouseleave', this.onMouseLeave);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.crosshair.remove();
    this.renderer.domElement.style.cursor = '';
    this.player.dispose();
    this.channel.close();
    clearTweens();
    dismissToast();
    this.renderer.dispose();
  }
}
