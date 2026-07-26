// Third-person player character (Day / Night / Dusk) with WASD movement and a
// chase camera orbited by mouse drag.

import * as THREE from 'three';
import type { PlayerPose, PlayerRole } from '../../../shared/types.ts';
import { cameraMode, getSettings } from '../settings.ts';
import { ACTOR_HEIGHT, PLAYER_RADIUS, STEP_UP } from '../../../shared/terrain.ts';
import type { PushBox, TerrainBody } from '../../../shared/terrain.ts';
import type { Terrain } from './platforms.ts';

/**
 * Jump tuning. `JUMP_SPEED²/(2·GRAVITY)` is the apex — about 2.4 — which is what
 * the Skyway pack's heights are built around: you can always hop a 2-unit step
 * (one crate, or one platform tier) but never two.
 */
const JUMP_SPEED = 10.8;
const GRAVITY = 24;

/** A solid a character is pushed out of: a vertical cylinder over a height band. */
export interface Collider {
  x: number;
  z: number;
  radius: number;
  /** Base height; the collider only applies to actors standing near it. */
  y: number;
}

/** How far above/below a collider's base an actor still bumps into it. */
const COLLIDER_BAND = 2.5;

const ROLE_STYLE: Record<PlayerRole, { body: number; accent: number; emissive: number }> = {
  day: { body: 0xffc776, accent: 0xfff3e2, emissive: 0x8a5a1a },
  night: { body: 0x3d4e9e, accent: 0x8ea6ff, emissive: 0x1a2455 },
  dusk: { body: 0x8a5fae, accent: 0xe8b3ff, emissive: 0x3d2455 },
};

export function buildCharacterMesh(role: PlayerRole): THREE.Group {
  const style = ROLE_STYLE[role];
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: style.body,
    emissive: style.emissive,
    emissiveIntensity: 0.35,
    roughness: 0.6,
  });
  const accentMat = new THREE.MeshStandardMaterial({ color: style.accent, roughness: 0.4 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.8, 6, 14), bodyMat);
  body.position.y = 1.0;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 14), accentMat);
  head.position.y = 1.95;
  head.castShadow = true;
  group.add(head);

  // Little cloak cone to feel like a wandering spirit.
  const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.9, 12, 1, true), bodyMat);
  cloak.position.y = 0.55;
  group.add(cloak);

  // Eyes so facing direction is readable.
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2b1b4d });
  for (const dx of [-0.12, 0.12]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), eyeMat);
    eye.position.set(dx, 2.0, 0.3);
    group.add(eye);
  }

  if (role === 'night' || role === 'dusk') {
    // Tiny star specks orbiting the night-ish characters.
    const starMat = new THREE.MeshBasicMaterial({ color: 0xdfe8ff });
    for (let i = 0; i < 5; i++) {
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), starMat);
      const a = (i / 5) * Math.PI * 2;
      star.position.set(Math.cos(a) * 0.7, 1.3 + Math.sin(a * 2) * 0.4, Math.sin(a) * 0.7);
      group.add(star);
    }
  }
  return group;
}

/**
 * Re-skin an existing character in another role's colors, in place: the group
 * itself stays in the scene (and in whatever is holding a reference to it) while
 * its parts are rebuilt. Hot-seat swapping is the only caller.
 */
export function restyleCharacter(group: THREE.Group, role: PlayerRole): void {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      for (const mat of Array.isArray(child.material) ? child.material : [child.material]) mat.dispose();
    }
  }
  for (const child of [...buildCharacterMesh(role).children]) group.add(child);
}

export class Player implements TerrainBody {
  readonly mesh: THREE.Group;
  role: PlayerRole;
  yaw = 0; // facing direction
  moving = false;
  /** Off while the intro cutscene drives the camera itself. */
  cameraEnabled = true;
  /** Off until the intro brings the player into frame. */
  controlsEnabled = true;
  /** Which controls the player has actually tried — read by the guide overlay. */
  readonly usedKeys = new Set<string>();
  /** Total camera rotation so far, radians; tells us mouse-look has clicked. */
  turned = 0;
  /** Solid pedestals to slide around (crystals are pass-through). */
  private colliders: Collider[] = [];
  /** Skyway levels: platforms to stand on and crates to push. */
  private terrain: Terrain | null = null;
  private velocity = new THREE.Vector3();
  private keys = new Set<string>();
  private cameraYaw = 0;
  private cameraPitch = 0.42;
  private cameraDist = 9;
  private bobTime = 0;
  private dragging = false;
  /** Physics height of the feet (the idle/walk bob is applied on top for display). */
  private feetY = 0;
  private vy = 0;
  private grounded = true;

  constructor(
    role: PlayerRole,
    private camera: THREE.PerspectiveCamera,
    private heightAt: (x: number, z: number) => number,
    private domElement: HTMLElement
  ) {
    this.role = role;
    this.mesh = buildCharacterMesh(role);
    this.mesh.position.set(role === 'night' ? 3 : -3, 0, 22);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    domElement.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('blur', this.onBlur);
    domElement.addEventListener('contextmenu', this.onContextMenu);
    domElement.addEventListener('wheel', this.onWheel, { passive: false });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.domElement.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('blur', this.onBlur);
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    this.domElement.removeEventListener('wheel', this.onWheel);
    if (document.pointerLockElement === this.domElement) document.exitPointerLock();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (!this.controlsEnabled) return;
    // Space only records the key here; `update` starts each jump from the held
    // state. Jumping on the keydown edge stopped bouncing as soon as another
    // key was pressed, because that cancels the OS auto-repeat for Space.
    if (e.code === 'Space') e.preventDefault(); // don't scroll or re-fire a focused button
    this.keys.add(e.code);
    this.usedKeys.add(e.code);
  };

  /**
   * Set the pedestals the player collides with. Each is a vertical cylinder the
   * player is pushed out of; only the generator's stone counts — the floating
   * crystals and cage stay pass-through.
   */
  setColliders(colliders: Collider[]): void {
    this.colliders = colliders;
  }

  /** Attach (or clear) the level's platforms and pushable crates. */
  setTerrain(terrain: Terrain | null): void {
    this.terrain = terrain;
  }

  /** Where an extending platform finds us: a box centred on our feet. */
  pushBox(): PushBox {
    return {
      x: this.mesh.position.x,
      z: this.mesh.position.z,
      feetY: this.feetY,
      half: PLAYER_RADIUS,
      height: ACTOR_HEIGHT,
    };
  }

  /**
   * Shoved by a growing platform. A push upward means we are riding it, so any
   * fall in progress is cancelled and we count as standing on it; a push
   * downward can only ever squeeze us, so it kills any rise.
   */
  shove(dx: number, dy: number, dz: number): void {
    this.mesh.position.x += dx;
    this.mesh.position.z += dz;
    if (dy === 0) return;
    this.feetY += dy;
    this.mesh.position.y = this.feetY;
    if (dy > 0) {
      this.vy = Math.max(this.vy, 0);
      this.grounded = true;
    } else {
      this.vy = Math.min(this.vy, 0);
    }
  }

  /** Hot seat: become the other character (their colors; the caller moves us). */
  setRole(role: PlayerRole): void {
    this.role = role;
    restyleCharacter(this.mesh, role);
  }

  /** Move the player to a level's start position, dropping them onto the ground. */
  placeAt(x: number, z: number): void {
    this.mesh.position.set(x, 0, z);
    this.feetY = this.surfaceAt(x, z, Infinity);
    this.vy = 0;
    this.grounded = true;
    this.mesh.position.y = this.feetY;
  }

  /** Highest surface at (x, z) reachable from feet at `feetY` — terrain or platform. */
  private surfaceAt(x: number, z: number, feetY: number): number {
    return this.terrain ? this.terrain.supportAt(x, z, feetY) : this.heightAt(x, z);
  }

  /** Slide the player out of any pedestal it has walked into (horizontal only). */
  private resolveCollisions(): void {
    const p = this.mesh.position;
    for (const c of this.colliders) {
      // A generator up on a platform must not wall off the ground below it.
      if (Math.abs(this.feetY - c.y) > COLLIDER_BAND) continue;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const min = c.radius + PLAYER_RADIUS;
      const distSq = dx * dx + dz * dz;
      if (distSq >= min * min) continue;
      const dist = Math.sqrt(distSq);
      if (dist > 1e-4) {
        const push = min / dist;
        p.x = c.x + dx * push;
        p.z = c.z + dz * push;
      } else {
        // Dead-center: shove straight out along +z so we never divide by zero.
        p.z = c.z + min;
      }
    }
  }

  /** Keys down right now (the guide overlay lights up matching keycaps). */
  get heldKeys(): ReadonlySet<string> {
    return this.keys;
  }

  /** Physics height of the feet, without the walk/idle bob. */
  get feetHeight(): number {
    return this.feetY;
  }
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => this.keys.clear();
  private onMouseDown = (e: MouseEvent) => {
    if (!this.controlsEnabled) return;
    const mode = cameraMode();
    if (mode === 'drag' && e.button === 2) {
      this.dragging = true;
    } else if (mode === 'pointerlock' && e.button === 0 && document.pointerLockElement !== this.domElement) {
      this.domElement.requestPointerLock()?.catch(() => {});
    }
  };
  private onMouseUp = () => (this.dragging = false);
  private onMouseMove = (e: MouseEvent) => {
    const locked = document.pointerLockElement === this.domElement;
    if (!this.dragging && !locked) return;
    const sens = getSettings().mouseSensitivity;
    const dYaw = e.movementX * 0.0045 * sens;
    const before = this.cameraPitch;
    this.cameraYaw -= dYaw;
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + e.movementY * 0.003 * sens, 0.08, 1.15);
    this.turned += Math.abs(dYaw) + Math.abs(this.cameraPitch - before);
  };
  private onContextMenu = (e: MouseEvent) => e.preventDefault();
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.cameraDist = THREE.MathUtils.clamp(this.cameraDist + e.deltaY * 0.01, 4, 22);
  };

  update(dt: number): void {
    const held = (code: string) => (this.controlsEnabled && this.keys.has(code) ? 1 : 0);
    const forward = held('KeyW') - held('KeyS');
    const strafe = held('KeyD') - held('KeyA');
    const speed = 8;

    const move = new THREE.Vector3();
    if (forward !== 0 || strafe !== 0) {
      // Camera-relative movement direction.
      const dir = new THREE.Vector3(Math.sin(this.cameraYaw), 0, Math.cos(this.cameraYaw));
      const right = new THREE.Vector3(dir.z, 0, -dir.x);
      move.addScaledVector(dir, -forward).addScaledVector(right, strafe).normalize();
      this.yaw = Math.atan2(move.x, move.z);
    }
    this.moving = move.lengthSq() > 0;

    this.velocity.lerp(move.multiplyScalar(speed), 1 - Math.exp(-10 * dt));
    this.mesh.position.addScaledVector(this.velocity, dt);

    // Push back out of any pedestal we've stepped into.
    this.resolveCollisions();
    // Then out of platform walls — and this is where crates get shoved. Only a
    // grounded player pushes: shoving a crate from mid-air would let you nudge
    // one you are standing beside but not actually leaning into.
    this.terrain?.resolve(this.mesh.position, PLAYER_RADIUS, this.feetY, this.grounded);

    // Keep inside the world.
    const maxDist = 200;
    const planar = Math.hypot(this.mesh.position.x, this.mesh.position.z);
    if (planar > maxDist) {
      this.mesh.position.x *= maxDist / planar;
      this.mesh.position.z *= maxDist / planar;
    }

    // Held Space re-launches the moment we touch down, so you keep bouncing for
    // as long as it's down no matter what else is being pressed.
    if (held('Space') && this.grounded) {
      this.vy = JUMP_SPEED;
      this.grounded = false;
    }

    // Vertical integration. The support test uses the feet height from BEFORE
    // this step, so a fall can never pass through a platform: every surface we
    // were above is still a landing candidate, and we take the highest.
    const prevFeetY = this.feetY;
    this.vy -= GRAVITY * dt;
    this.feetY += this.vy * dt;
    const support = this.surfaceAt(this.mesh.position.x, this.mesh.position.z, prevFeetY);
    if (this.feetY <= support && this.vy <= 0) {
      // Landing, or stepping up onto a low ledge (anything within STEP_UP).
      this.feetY = support;
      this.vy = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    if (this.grounded) {
      this.bobTime += dt * (this.moving ? 9 : 2.4);
      this.mesh.position.y =
        this.feetY + (this.moving ? Math.abs(Math.sin(this.bobTime)) * 0.12 : Math.sin(this.bobTime) * 0.04);
    } else {
      this.mesh.position.y = this.feetY;
    }

    // Smoothly face movement direction.
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0));
    this.mesh.quaternion.slerp(target, 1 - Math.exp(-12 * dt));

    if (this.cameraEnabled) this.updateCamera(dt);
  }

  /** Where the chase camera wants to be right now, without moving it there. */
  cameraPose(): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const dist = this.cameraDist;
    const p = this.mesh.position;
    const cx = p.x + Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch) * dist;
    const cz = p.z + Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch) * dist;
    const cy = p.y + Math.sin(this.cameraPitch) * dist + 1.4;
    // Keep the camera above whatever it is over — the terrain, or a platform.
    const minY = this.surfaceAt(cx, cz, cy) + 0.8;
    return {
      pos: new THREE.Vector3(cx, Math.max(cy, minY), cz),
      look: new THREE.Vector3(p.x, p.y + 1.6, p.z),
    };
  }

  private updateCamera(dt: number): void {
    const { pos, look } = this.cameraPose();
    this.camera.position.lerp(pos, 1 - Math.exp(-8 * dt));
    this.camera.lookAt(look);
  }

  /** Put the camera on its chase mark immediately (used when skipping the intro). */
  snapCamera(): void {
    const { pos, look } = this.cameraPose();
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
  }

  getPose(): PlayerPose {
    return {
      x: this.mesh.position.x,
      z: this.mesh.position.z,
      ry: this.yaw,
      moving: this.moving,
      // `jump` stays height-above-terrain for older peers; `y` is what a client
      // that knows about platforms actually uses.
      jump: Math.max(0, this.feetY - this.heightAt(this.mesh.position.x, this.mesh.position.z)),
      y: this.feetY,
    };
  }
}

/** The other player's character, driven by network pose updates. */
export class RemotePlayer {
  readonly mesh: THREE.Group;
  private target = new THREE.Vector3();
  private targetYaw = 0;
  private moving = false;
  private targetJump = 0;
  private jump = 0;
  /** Absolute height sent by a platform-aware peer, or null to fall back to `jump`. */
  private targetY: number | null = null;
  private y = 0;
  private bobTime = 0;

  constructor(role: PlayerRole, private heightAt: (x: number, z: number) => number) {
    this.mesh = buildCharacterMesh(role);
    this.mesh.position.set(role === 'night' ? 3 : -3, 0, 22);
    this.target.copy(this.mesh.position);
  }

  /** Hot seat: this body is now the other role (the player took ours over). */
  setRole(role: PlayerRole): void {
    restyleCharacter(this.mesh, role);
  }

  /**
   * Hot seat: stand exactly here, right now. `applyPose` eases toward a peer's
   * position, which would send the character we just stepped out of gliding
   * across the level instead of staying put.
   */
  snapTo(pose: PlayerPose): void {
    this.applyPose(pose);
    this.mesh.position.set(pose.x, pose.y ?? this.heightAt(pose.x, pose.z), pose.z);
    this.y = this.mesh.position.y;
    this.jump = this.targetJump;
    this.mesh.rotation.set(0, pose.ry, 0);
  }

  applyPose(pose: PlayerPose): void {
    this.target.set(pose.x, 0, pose.z);
    this.targetYaw = pose.ry;
    this.moving = pose.moving;
    this.targetJump = pose.jump ?? 0;
    this.targetY = pose.y ?? null;
  }

  update(dt: number): void {
    this.mesh.position.x += (this.target.x - this.mesh.position.x) * Math.min(1, 10 * dt);
    this.mesh.position.z += (this.target.z - this.mesh.position.z) * Math.min(1, 10 * dt);
    const groundY = this.heightAt(this.mesh.position.x, this.mesh.position.z);
    if (this.targetY !== null) {
      // Platform-aware peer: follow their absolute height, and bob only while
      // they are on a surface (i.e. not rising or falling through the air).
      this.y += (this.targetY - this.y) * Math.min(1, 15 * dt);
      const settled = Math.abs(this.targetY - this.y) < 0.05;
      this.bobTime += dt * (this.moving ? 9 : 2.4);
      const bob = settled
        ? this.moving
          ? Math.abs(Math.sin(this.bobTime)) * 0.12
          : Math.sin(this.bobTime) * 0.04
        : 0;
      this.mesh.position.y = this.y + bob;
      const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.targetYaw, 0));
      this.mesh.quaternion.slerp(target, 1 - Math.exp(-10 * dt));
      return;
    }
    this.jump += (this.targetJump - this.jump) * Math.min(1, 15 * dt);
    if (this.jump > 0.02) {
      this.mesh.position.y = groundY + this.jump;
    } else {
      this.bobTime += dt * (this.moving ? 9 : 2.4);
      this.mesh.position.y = groundY + (this.moving ? Math.abs(Math.sin(this.bobTime)) * 0.12 : Math.sin(this.bobTime) * 0.04);
    }
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.targetYaw, 0));
    this.mesh.quaternion.slerp(target, 1 - Math.exp(-10 * dt));
  }
}
