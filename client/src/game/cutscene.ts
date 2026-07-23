// Standalone cutscene viewer (the `/cutscene` page): sets up just enough of the
// real scene — world, a stand-in player for the chase pose, and the renderer —
// to play the opening `IntroSequence` on a loop, so the animation can be watched
// in isolation without starting a game. It reuses the exact same intro code the
// game runs, so what you see here is what players see.

import * as THREE from 'three';
import { STARTER_PACK_NAME } from '../../../shared/levels.ts';
import { getSettings, pixelRatioFor } from '../settings.ts';
import { el, uiRoot } from '../screens/ui.ts';
import { IntroSequence } from './intro.ts';
import { Player } from './player.ts';
import { World } from './world.ts';

/** Pause between one playthrough finishing and the next starting, in seconds. */
const REPLAY_GAP = 1.2;

export function runCutscene(packName = STARTER_PACK_NAME): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const highQuality = getSettings().quality === 'high';

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: highQuality });
  renderer.setPixelRatio(pixelRatioFor(getSettings()));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 2000);
  const world = new World(20260719);

  // The player is only here to supply the chase pose the intro settles onto; it
  // never takes control, so its input stays disabled for the whole loop.
  const player = new Player('dusk', camera, world.heightAt, canvas);
  player.cameraEnabled = false;
  player.controlsEnabled = false;
  world.scene.add(player.mesh);

  const replayHint = el('div', { className: 'subtitle cutscene-hint', text: 'Replaying…' });
  uiRoot().append(replayHint);

  let intro: IntroSequence | null = null;
  let replayAt = 0; // performance.now() timestamp at which to start the next loop
  let lastTime = performance.now();

  const startIntro = () => {
    replayHint.classList.remove('visible');
    intro = new IntroSequence({
      scene: world.scene,
      camera,
      packName,
      chasePose: () => player.cameraPose(),
      onControlsUnlocked: () => {},
      onFinish: () => {
        intro = null;
        replayHint.classList.add('visible');
        replayAt = performance.now() + REPLAY_GAP * 1000;
      },
    });
  };

  startIntro();

  let running = false;
  let scheduled = false;
  let lastRender = 0;

  const frame = (now: number): void => {
    scheduled = false;
    if (!running) return;
    ensureScheduled();

    const cap = getSettings().fpsCap;
    if (cap > 0 && now - lastRender < 1000 / cap - 1) return;
    lastRender = now;

    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    if (intro) intro.update();
    else if (now >= replayAt) startIntro();
    renderer.render(world.scene, camera);
  };

  function ensureScheduled(): void {
    if (scheduled || !running) return;
    scheduled = true;
    requestAnimationFrame(frame);
  }

  const resume = (): void => {
    if (running) return;
    running = true;
    lastTime = performance.now();
    ensureScheduled();
  };
  const pause = (): void => {
    running = false;
  };

  window.addEventListener('blur', pause);
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));
  resume();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
