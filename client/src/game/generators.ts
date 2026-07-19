// Crystal generators: clickable pedestals. Day generators are warm sandstone
// with a glowing ring; night generators are dark stone with orbiting stars.
// A floating sign above each shows exactly what one press produces.

import * as THREE from 'three';
import type { GeneratorDef, LevelDef, Side } from '../../../shared/types.ts';
import { collectColors, COLOR_HEX, DAY_PLATFORM_X, NIGHT_PLATFORM_X } from './crystals.ts';
import { tween } from './anim.ts';

export class GeneratorStand {
  readonly root = new THREE.Group();
  readonly def: GeneratorDef;
  readonly clickTargets: THREE.Object3D[] = [];
  private crown: THREE.Group;
  private ring: THREE.Mesh;
  private outline = new THREE.Group();
  private time = Math.random() * 10;

  constructor(def: GeneratorDef, position: THREE.Vector3) {
    this.def = def;
    this.root.position.copy(position);

    const isDay = def.side === 'day';
    const stoneMat = new THREE.MeshStandardMaterial({
      color: isDay ? 0xe0c18e : 0x2e3560,
      roughness: 0.8,
      flatShading: true,
    });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 0.6, 8), stoneMat);
    base.position.y = 0.3;
    base.castShadow = true;
    base.receiveShadow = true;
    this.root.add(base);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.0, 1.6, 8), stoneMat);
    column.position.y = 1.4;
    column.castShadow = true;
    this.root.add(column);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.85, 0.4, 8), stoneMat);
    top.position.y = 2.3;
    top.castShadow = true;
    this.root.add(top);
    this.clickTargets.push(base, column, top);

    // White shell shown while the player hovers the generator.
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide });
    for (const mesh of [base, column, top]) {
      const shell = new THREE.Mesh(mesh.geometry, outlineMat);
      shell.position.copy(mesh.position);
      shell.scale.setScalar(1.07);
      this.outline.add(shell);
    }
    this.outline.visible = false;
    this.root.add(this.outline);

    // Glow ring at the base marking the side.
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.8, 0.08, 8, 32),
      new THREE.MeshBasicMaterial({ color: isDay ? 0xffc776 : 0x8ea6ff, transparent: true, opacity: 0.9 })
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.08;
    this.root.add(this.ring);

    // The crown: one mini crystal per crystal produced (so "+2 red" shows two
    // red crystals), hovering above the pedestal.
    this.crown = new THREE.Group();
    this.crown.position.y = 3.2;
    const crownColors = def.outputs.flatMap((out) => Array<typeof out.color>(out.count).fill(out.color));
    const n = crownColors.length;
    const spacing = n <= 4 ? 1.0 : 4.0 / (n - 1);
    crownColors.forEach((color, i) => {
      const hex = COLOR_HEX[color][def.side];
      const mini = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.38, 0),
        new THREE.MeshPhysicalMaterial({
          color: hex,
          transparent: true,
          opacity: 0.9,
          emissive: hex,
          emissiveIntensity: isDay ? 0.6 : 0.25,
          flatShading: true,
        })
      );
      mini.position.x = n === 1 ? 0 : (i - (n - 1) / 2) * spacing;
      this.crown.add(mini);
      this.clickTargets.push(mini);
    });
    this.root.add(this.crown);

    // Sign showing the output, e.g. "+2 ◆  +1 ◆". Clicking it presses too.
    const sign = makeSignSprite(def);
    sign.position.y = 4.4;
    this.root.add(sign);
    this.clickTargets.push(sign);

    if (!isDay) {
      // Orbiting star specks for night generators.
      const starMat = new THREE.MeshBasicMaterial({ color: 0xdfe8ff });
      for (let i = 0; i < 6; i++) {
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), starMat);
        star.userData.orbit = { angle: (i / 6) * Math.PI * 2, radius: 1.35, speed: 0.8 + Math.random() * 0.4, y: 1.4 + Math.random() * 1.2 };
        this.root.add(star);
      }
    }

    for (const target of this.clickTargets) target.userData.generatorId = def.id;
  }

  /** Toggle the white hover outline. */
  setHovered(on: boolean): void {
    this.outline.visible = on;
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

  update(dt: number): void {
    this.time += dt;
    this.crown.rotation.y += dt * 0.9;
    this.crown.position.y = 3.2 + Math.sin(this.time * 1.8) * 0.15;
    const ringMat = this.ring.material as THREE.MeshBasicMaterial;
    ringMat.opacity = 0.65 + Math.sin(this.time * 2.4) * 0.25;
    for (const child of this.root.children) {
      const orbit = child.userData.orbit;
      if (orbit) {
        orbit.angle += dt * orbit.speed;
        child.position.set(Math.cos(orbit.angle) * orbit.radius, orbit.y + Math.sin(orbit.angle * 2) * 0.15, Math.sin(orbit.angle) * orbit.radius);
      }
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
