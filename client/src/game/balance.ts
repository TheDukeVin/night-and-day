// The balance ceremony: matching day/night crystals fly toward each other,
// meet in the middle and annihilate in a flash. Leftovers shake their heads
// and everything returns; if nothing is left over, the level is won.

import * as THREE from 'three';
import type { CrystalField } from './crystals.ts';
import { easeInOut, tween } from './anim.ts';

export function playBalanceAnimation(
  scene: THREE.Scene,
  field: CrystalField,
  onDone: () => void
): void {
  const clusters = field.getClusters();
  const byColor = new Map<string, { day?: (typeof clusters)[0]; night?: (typeof clusters)[0] }>();
  for (const cluster of clusters) {
    const entry = byColor.get(cluster.color) ?? {};
    entry[cluster.side] = cluster;
    byColor.set(cluster.color, entry);
  }

  let pending = 0;
  let leftovers: THREE.Group[] = [];
  let delay = 0.15;

  for (const { day, night } of byColor.values()) {
    const dayCrystals = day?.crystals ?? [];
    const nightCrystals = night?.crystals ?? [];
    const pairs = Math.min(dayCrystals.length, nightCrystals.length);

    for (let i = 0; i < pairs; i++) {
      const a = dayCrystals[i];
      const b = nightCrystals[i];
      const from1 = a.position.clone();
      const from2 = b.position.clone();
      const meet = from1.clone().add(from2).multiplyScalar(0.5);
      meet.y = Math.max(from1.y, from2.y) + 1.6;
      pending++;
      tween({
        duration: 0.9,
        delay,
        onUpdate: (t) => {
          const e = easeInOut(t);
          a.position.lerpVectors(from1, meet, e);
          b.position.lerpVectors(from2, meet, e);
          a.rotation.y += 0.2;
          b.rotation.y -= 0.2;
        },
        onDone: () => {
          a.visible = false;
          b.visible = false;
          spawnBurst(scene, meet);
          pending--;
        },
      });
      delay += 0.12;
    }
    leftovers = leftovers.concat(dayCrystals.slice(pairs), nightCrystals.slice(pairs));
  }

  // After all pairs annihilate, shake the leftovers, then hand control back.
  const totalPairTime = delay + 1.0;
  tween({
    duration: 0.01,
    delay: totalPairTime,
    onUpdate: () => {},
    onDone: () => {
      if (leftovers.length === 0) {
        onDone();
        return;
      }
      for (const leftover of leftovers) {
        const baseX = leftover.position.x;
        tween({
          duration: 0.8,
          onUpdate: (t) => {
            leftover.position.x = baseX + Math.sin(t * Math.PI * 6) * 0.25 * (1 - t);
          },
        });
      }
      tween({ duration: 0.01, delay: 1.1, onUpdate: () => {}, onDone });
    },
  });
}

function spawnBurst(scene: THREE.Scene, at: THREE.Vector3): void {
  const mat = new THREE.SpriteMaterial({ color: 0xfff3d0, transparent: true, opacity: 0.95, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.copy(at);
  sprite.scale.setScalar(0.3);
  scene.add(sprite);
  tween({
    duration: 0.5,
    onUpdate: (t) => {
      sprite.scale.setScalar(0.3 + t * 3.2);
      mat.opacity = 0.95 * (1 - t);
    },
    onDone: () => scene.remove(sprite),
  });

  // A few flying sparks.
  for (let i = 0; i < 6; i++) {
    const sparkMat = new THREE.SpriteMaterial({ color: 0xffe8a8, transparent: true, depthWrite: false });
    const spark = new THREE.Sprite(sparkMat);
    spark.position.copy(at);
    spark.scale.setScalar(0.18);
    scene.add(spark);
    const dir = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2).normalize();
    tween({
      duration: 0.6,
      onUpdate: (t) => {
        spark.position.copy(at).addScaledVector(dir, t * 2.4);
        spark.position.y -= t * t * 1.2;
        sparkMat.opacity = 1 - t;
      },
      onDone: () => scene.remove(spark),
    });
  }
}
