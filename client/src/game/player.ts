// Third-person player character (Day / Night / Dusk) with WASD movement and a
// chase camera orbited by mouse drag.

import * as THREE from 'three';
import type { PlayerPose, PlayerRole } from '../../../shared/types.ts';
import { getSettings } from '../settings.ts';

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

export class Player {
  readonly mesh: THREE.Group;
  readonly role: PlayerRole;
  yaw = 0; // facing direction
  moving = false;
  private velocity = new THREE.Vector3();
  private keys = new Set<string>();
  private cameraYaw = 0;
  private cameraPitch = 0.42;
  private bobTime = 0;
  private dragging = false;
  private jumpOffset = 0;
  private jumpVelocity = 0;
  private airborne = false;

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
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.domElement.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('blur', this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') {
      e.preventDefault(); // keep space from scrolling or re-triggering focused buttons
      if (!this.airborne) {
        this.airborne = true;
        this.jumpVelocity = 8.5;
      }
    }
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => this.keys.clear();
  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) this.dragging = true;
  };
  private onMouseUp = () => (this.dragging = false);
  private onMouseMove = (e: MouseEvent) => {
    if (!this.dragging) return;
    const sens = getSettings().mouseSensitivity;
    this.cameraYaw -= e.movementX * 0.0045 * sens;
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + e.movementY * 0.003 * sens, 0.08, 1.15);
  };

  update(dt: number): void {
    const forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
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

    // Keep inside the world.
    const maxDist = 200;
    const planar = Math.hypot(this.mesh.position.x, this.mesh.position.z);
    if (planar > maxDist) {
      this.mesh.position.x *= maxDist / planar;
      this.mesh.position.z *= maxDist / planar;
    }

    const groundY = this.heightAt(this.mesh.position.x, this.mesh.position.z);
    if (this.airborne) {
      this.jumpVelocity -= 24 * dt; // gravity
      this.jumpOffset += this.jumpVelocity * dt;
      if (this.jumpOffset <= 0) {
        this.jumpOffset = 0;
        this.jumpVelocity = 0;
        this.airborne = false;
      }
      this.mesh.position.y = groundY + this.jumpOffset;
    } else {
      this.bobTime += dt * (this.moving ? 9 : 2.4);
      this.mesh.position.y = groundY + (this.moving ? Math.abs(Math.sin(this.bobTime)) * 0.12 : Math.sin(this.bobTime) * 0.04);
    }

    // Smoothly face movement direction.
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0));
    this.mesh.quaternion.slerp(target, 1 - Math.exp(-12 * dt));

    this.updateCamera(dt);
  }

  private updateCamera(dt: number): void {
    const dist = 9;
    const p = this.mesh.position;
    const cx = p.x + Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch) * dist;
    const cz = p.z + Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch) * dist;
    const cy = p.y + Math.sin(this.cameraPitch) * dist + 1.4;
    const minY = this.heightAt(cx, cz) + 0.8;
    const targetPos = new THREE.Vector3(cx, Math.max(cy, minY), cz);
    this.camera.position.lerp(targetPos, 1 - Math.exp(-8 * dt));
    this.camera.lookAt(p.x, p.y + 1.6, p.z);
  }

  getPose(): PlayerPose {
    return { x: this.mesh.position.x, z: this.mesh.position.z, ry: this.yaw, moving: this.moving };
  }
}

/** The other player's character, driven by network pose updates. */
export class RemotePlayer {
  readonly mesh: THREE.Group;
  private target = new THREE.Vector3();
  private targetYaw = 0;
  private moving = false;
  private bobTime = 0;

  constructor(role: PlayerRole, private heightAt: (x: number, z: number) => number) {
    this.mesh = buildCharacterMesh(role);
    this.mesh.position.set(role === 'night' ? 3 : -3, 0, 22);
    this.target.copy(this.mesh.position);
  }

  applyPose(pose: PlayerPose): void {
    this.target.set(pose.x, 0, pose.z);
    this.targetYaw = pose.ry;
    this.moving = pose.moving;
  }

  update(dt: number): void {
    this.mesh.position.x += (this.target.x - this.mesh.position.x) * Math.min(1, 10 * dt);
    this.mesh.position.z += (this.target.z - this.mesh.position.z) * Math.min(1, 10 * dt);
    const groundY = this.heightAt(this.mesh.position.x, this.mesh.position.z);
    this.bobTime += dt * (this.moving ? 9 : 2.4);
    this.mesh.position.y = groundY + (this.moving ? Math.abs(Math.sin(this.bobTime)) * 0.12 : Math.sin(this.bobTime) * 0.04);
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.targetYaw, 0));
    this.mesh.quaternion.slerp(target, 1 - Math.exp(-10 * dt));
  }
}
