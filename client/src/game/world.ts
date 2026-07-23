// The world: procedurally generated grassy plains, distant mountains, a gradient
// sky, lighting and fog — all deterministic per seed. The sky/lights/fog can
// cross-fade between three atmospheres: `sunset` (the original dusk look, used by
// Sunset levels), `day` (bright, with a sun that arcs so shadows sweep across the
// ground), and `night` (dark sky with stars overhead and fireflies near the
// player). Cycle levels switch atmosphere as play passes between the sides.

import * as THREE from 'three';
import { haloTexture } from './crystals.ts';

export type Atmosphere = 'sunset' | 'day' | 'night';

/** All the lerp-able scene values that define one atmosphere. */
interface AtmoState {
  zenith: THREE.Color;
  mid: THREE.Color;
  low: THREE.Color;
  horizon: THREE.Color;
  glow: THREE.Color; // additive warmth near the sun
  fog: THREE.Color;
  fogNear: number;
  fogFar: number;
  sunLightColor: THREE.Color;
  sunLightIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  rimIntensity: number;
  sunColor: THREE.Color; // the sun/moon disc
  sunPos: THREE.Vector3; // disc position in the sky
  lightPos: THREE.Vector3; // directional-light position (shadow direction)
  starOpacity: number;
  fireflyOpacity: number;
}

function atmo(mode: Atmosphere): AtmoState {
  switch (mode) {
    case 'day':
      return {
        zenith: new THREE.Color(0.25, 0.45, 0.85),
        mid: new THREE.Color(0.45, 0.62, 0.92),
        low: new THREE.Color(0.72, 0.84, 0.98),
        horizon: new THREE.Color(0.88, 0.94, 1.0),
        glow: new THREE.Color(0.35, 0.32, 0.18),
        fog: new THREE.Color(0xbfe0ff),
        fogNear: 80,
        fogFar: 620,
        sunLightColor: new THREE.Color(0xfff4d6),
        sunLightIntensity: 2.0,
        hemiSky: new THREE.Color(0x9ecbff),
        hemiGround: new THREE.Color(0x6f8f52),
        hemiIntensity: 1.05,
        rimIntensity: 0.2,
        sunColor: new THREE.Color(0xfff2c0),
        sunPos: new THREE.Vector3(120, 260, -760),
        lightPos: new THREE.Vector3(24, 46, -34),
        starOpacity: 0,
        fireflyOpacity: 0,
      };
    case 'night':
      return {
        zenith: new THREE.Color(0.02, 0.03, 0.1),
        mid: new THREE.Color(0.04, 0.06, 0.16),
        low: new THREE.Color(0.08, 0.1, 0.24),
        horizon: new THREE.Color(0.14, 0.16, 0.34),
        glow: new THREE.Color(0.04, 0.05, 0.12),
        fog: new THREE.Color(0x0a0e22),
        fogNear: 45,
        fogFar: 360,
        sunLightColor: new THREE.Color(0x9fb0e6),
        sunLightIntensity: 0.4,
        hemiSky: new THREE.Color(0x2a2f5a),
        hemiGround: new THREE.Color(0x161d31),
        hemiIntensity: 0.55,
        rimIntensity: 0.15,
        sunColor: new THREE.Color(0xdfe6ff), // the moon
        sunPos: new THREE.Vector3(-160, 300, -700),
        lightPos: new THREE.Vector3(-26, 40, -40),
        starOpacity: 1,
        fireflyOpacity: 1,
      };
    case 'sunset':
    default:
      return {
        zenith: new THREE.Color(0.17, 0.11, 0.32),
        mid: new THREE.Color(0.55, 0.27, 0.45),
        low: new THREE.Color(0.95, 0.55, 0.42),
        horizon: new THREE.Color(1.0, 0.8, 0.48),
        glow: new THREE.Color(0.25, 0.12, 0.02),
        fog: new THREE.Color(0xe8a06f),
        fogNear: 60,
        fogFar: 420,
        sunLightColor: new THREE.Color(0xffc98a),
        sunLightIntensity: 1.6,
        hemiSky: new THREE.Color(0x9a7bd0),
        hemiGround: new THREE.Color(0x4a5d3a),
        hemiIntensity: 0.75,
        rimIntensity: 0.35,
        sunColor: new THREE.Color(0xffdf9e),
        sunPos: new THREE.Vector3(0, 26, -820),
        lightPos: new THREE.Vector3(10, 34, -60),
        starOpacity: 0,
        fireflyOpacity: 0,
      };
  }
}

/** Copy `src` into `dst` (in place), so we can snapshot without allocating. */
function copyAtmo(dst: AtmoState, src: AtmoState): void {
  dst.zenith.copy(src.zenith);
  dst.mid.copy(src.mid);
  dst.low.copy(src.low);
  dst.horizon.copy(src.horizon);
  dst.glow.copy(src.glow);
  dst.fog.copy(src.fog);
  dst.fogNear = src.fogNear;
  dst.fogFar = src.fogFar;
  dst.sunLightColor.copy(src.sunLightColor);
  dst.sunLightIntensity = src.sunLightIntensity;
  dst.hemiSky.copy(src.hemiSky);
  dst.hemiGround.copy(src.hemiGround);
  dst.hemiIntensity = src.hemiIntensity;
  dst.rimIntensity = src.rimIntensity;
  dst.sunColor.copy(src.sunColor);
  dst.sunPos.copy(src.sunPos);
  dst.lightPos.copy(src.lightPos);
  dst.starOpacity = src.starOpacity;
  dst.fireflyOpacity = src.fireflyOpacity;
}

/** Interpolate `a`→`b` by `t` into `out`. */
function lerpAtmo(out: AtmoState, a: AtmoState, b: AtmoState, t: number): void {
  out.zenith.copy(a.zenith).lerp(b.zenith, t);
  out.mid.copy(a.mid).lerp(b.mid, t);
  out.low.copy(a.low).lerp(b.low, t);
  out.horizon.copy(a.horizon).lerp(b.horizon, t);
  out.glow.copy(a.glow).lerp(b.glow, t);
  out.fog.copy(a.fog).lerp(b.fog, t);
  out.fogNear = THREE.MathUtils.lerp(a.fogNear, b.fogNear, t);
  out.fogFar = THREE.MathUtils.lerp(a.fogFar, b.fogFar, t);
  out.sunLightColor.copy(a.sunLightColor).lerp(b.sunLightColor, t);
  out.sunLightIntensity = THREE.MathUtils.lerp(a.sunLightIntensity, b.sunLightIntensity, t);
  out.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, t);
  out.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, t);
  out.hemiIntensity = THREE.MathUtils.lerp(a.hemiIntensity, b.hemiIntensity, t);
  out.rimIntensity = THREE.MathUtils.lerp(a.rimIntensity, b.rimIntensity, t);
  out.sunColor.copy(a.sunColor).lerp(b.sunColor, t);
  out.sunPos.copy(a.sunPos).lerp(b.sunPos, t);
  out.lightPos.copy(a.lightPos).lerp(b.lightPos, t);
  out.starOpacity = THREE.MathUtils.lerp(a.starOpacity, b.starOpacity, t);
  out.fireflyOpacity = THREE.MathUtils.lerp(a.fireflyOpacity, b.fireflyOpacity, t);
}

const ATMO_FADE = 2.6; // seconds for a full atmosphere cross-fade

/** Small seeded RNG (mulberry32) so terrain is procedural but repeatable. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap value noise for gentle terrain undulation. */
function makeNoise(rand: () => number): (x: number, z: number) => number {
  const grid = 16;
  const values: number[] = [];
  for (let i = 0; i < grid * grid; i++) values.push(rand());
  const at = (ix: number, iz: number) =>
    values[((iz % grid) + grid) % grid * grid + (((ix % grid) + grid) % grid)];
  return (x, z) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = at(ix, iz);
    const b = at(ix + 1, iz);
    const c = at(ix, iz + 1);
    const d = at(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
}

export class World {
  readonly scene: THREE.Scene;
  readonly heightAt: (x: number, z: number) => number;

  // Retained scene handles so the atmosphere can be re-tinted every frame.
  private skyMat!: THREE.ShaderMaterial;
  private sunMesh!: THREE.Mesh;
  private sunLight!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private rim!: THREE.DirectionalLight;
  private fog!: THREE.Fog;
  private stars!: THREE.Points;
  private starMat!: THREE.PointsMaterial;
  private fireflies: THREE.Group | null = null;
  private fireflyData: { angle: number; radius: number; speed: number; y: number; phase: number }[] = [];

  // Atmosphere cross-fade: `from`→`to` over `fadeT` (0..1); `disp` is applied.
  private mode: Atmosphere = 'sunset';
  private prevMode: Atmosphere = 'sunset';
  private from = atmo('sunset');
  private to = atmo('sunset');
  private disp = atmo('sunset');
  private fadeT = 1;
  // When a day↔night transition is requested we don't jump straight across:
  // we cross-fade to `sunset` first, then on to the target here — so the sky
  // eases through dusk the way it would in nature (day→sunset→night etc.).
  private pendingMode: Atmosphere | null = null;
  private sunAngle = 0; // advancing arc position of the daytime sun

  constructor(seed: number) {
    this.scene = new THREE.Scene();
    const rand = seededRandom(seed);
    const noise = makeNoise(rand);

    // Terrain height: flat near the play area, gentle rolls further out.
    this.heightAt = (x: number, z: number) => {
      const d = Math.sqrt(x * x + z * z);
      const flatten = THREE.MathUtils.smoothstep(d, 18, 60); // 0 near center -> 1 far
      return noise(x * 0.04 + 3, z * 0.04 + 7) * 3.2 * flatten;
    };

    this.buildSky();
    this.buildLights();
    this.buildStars(rand);
    this.buildFireflies();
    this.buildTerrain();
    this.buildMountains(rand);
    this.buildGrass(rand);
    this.buildClouds(rand);
    this.applyAtmo(); // snap to the initial (sunset) look
  }

  private buildSky(): void {
    // Big inverted sphere with a vertical gradient driven by colour uniforms so
    // it can cross-fade between atmospheres.
    const geo = new THREE.SphereGeometry(900, 32, 24);
    const s = this.from;
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: s.zenith.clone() },
        uMid: { value: s.mid.clone() },
        uLow: { value: s.low.clone() },
        uHorizon: { value: s.horizon.clone() },
        uGlow: { value: s.glow.clone() },
        uSunDir: { value: s.sunPos.clone().normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vPos;
        uniform vec3 uZenith;
        uniform vec3 uMid;
        uniform vec3 uLow;
        uniform vec3 uHorizon;
        uniform vec3 uGlow;
        uniform vec3 uSunDir;
        void main() {
          vec3 dir = normalize(vPos);
          float h = dir.y; // -1 .. 1
          vec3 c = mix(uHorizon, uLow, smoothstep(0.0, 0.12, h));
          c = mix(c, uMid, smoothstep(0.10, 0.35, h));
          c = mix(c, uZenith, smoothstep(0.30, 0.75, h));
          // Extra glow toward the sun/moon direction, fading with height.
          float sunward = smoothstep(0.55, 1.0, dot(dir, uSunDir)) * smoothstep(0.4, 0.0, abs(h));
          c += uGlow * (1.0 + sunward * 3.0);
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(geo, this.skyMat));

    // The sun (daytime) / moon (night) disc.
    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(28, 24, 24),
      new THREE.MeshBasicMaterial({ color: s.sunColor.clone() })
    );
    this.sunMesh.position.copy(s.sunPos);
    this.scene.add(this.sunMesh);

    this.fog = new THREE.Fog(s.fog.getHex(), s.fogNear, s.fogFar);
    this.scene.fog = this.fog;
  }

  private buildLights(): void {
    const s = this.from;
    this.sunLight = new THREE.DirectionalLight(s.sunLightColor.getHex(), s.sunLightIntensity);
    this.sunLight.position.copy(s.lightPos);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -45;
    this.sunLight.shadow.camera.right = 45;
    this.sunLight.shadow.camera.top = 45;
    this.sunLight.shadow.camera.bottom = -45;
    this.sunLight.shadow.camera.far = 160;
    this.sunLight.shadow.bias = -0.0015;
    this.scene.add(this.sunLight);

    this.hemi = new THREE.HemisphereLight(s.hemiSky.getHex(), s.hemiGround.getHex(), s.hemiIntensity);
    this.scene.add(this.hemi);
    this.rim = new THREE.DirectionalLight(0x8ea6ff, s.rimIntensity);
    this.rim.position.set(-20, 18, 50);
    this.scene.add(this.rim);
  }

  /** A dome of tiny star points overhead, faded in only at night. */
  private buildStars(rand: () => number): void {
    const count = 1400;
    const positions: number[] = [];
    for (let i = 0; i < count; i++) {
      // Points on the upper half of a large sphere.
      const u = rand();
      const v = rand() * 0.5; // upper hemisphere
      const theta = u * Math.PI * 2;
      const phi = Math.acos(1 - v); // 0 (up) .. ~90deg
      const r = 780;
      positions.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi) + 40,
        r * Math.sin(phi) * Math.sin(theta)
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 3.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.renderOrder = -1;
    this.scene.add(this.stars);
  }

  /** A cloud of glowing motes that drift near the player, seen only at night. */
  private buildFireflies(): void {
    const tex = haloTexture();
    this.fireflies = new THREE.Group();
    const count = 26;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: 0xffe89a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.setScalar(0.7);
      this.fireflies.add(sprite);
      this.fireflyData.push({
        angle: Math.random() * Math.PI * 2,
        radius: 3 + Math.random() * 9,
        speed: (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.5),
        y: 1 + Math.random() * 3,
        phase: Math.random() * Math.PI * 2,
      });
    }
    this.scene.add(this.fireflies);
  }

  /**
   * Begin a transition to `mode`. With `animate` false it snaps immediately
   * (used when a level first loads); otherwise it cross-fades over ~2.6s.
   */
  setAtmosphere(mode: Atmosphere, animate = true): void {
    if (mode === this.mode && this.fadeT >= 1 && this.pendingMode === null) return;
    // A day↔night change routes through sunset: fade to sunset now, then let
    // `update` carry on to the real target once that first leg completes.
    const viaSunset =
      animate &&
      ((this.mode === 'day' && mode === 'night') || (this.mode === 'night' && mode === 'day'));
    this.pendingMode = viaSunset ? mode : null;
    const next = viaSunset ? 'sunset' : mode;
    this.beginFade(next, animate);
  }

  /** Snapshot the shown values as `from`, aim `to` at `mode`, and start a fade. */
  private beginFade(mode: Atmosphere, animate: boolean): void {
    this.prevMode = this.mode;
    this.mode = mode;
    copyAtmo(this.from, this.disp); // start from what is currently shown
    copyAtmo(this.to, atmo(mode));
    this.fadeT = animate ? 0 : 1;
    if (!animate) {
      copyAtmo(this.disp, this.to);
      this.applyAtmo();
    }
  }

  /** Push `disp` values onto the actual scene objects. */
  private applyAtmo(): void {
    const d = this.disp;
    (this.skyMat.uniforms.uZenith.value as THREE.Color).copy(d.zenith);
    (this.skyMat.uniforms.uMid.value as THREE.Color).copy(d.mid);
    (this.skyMat.uniforms.uLow.value as THREE.Color).copy(d.low);
    (this.skyMat.uniforms.uHorizon.value as THREE.Color).copy(d.horizon);
    (this.skyMat.uniforms.uGlow.value as THREE.Color).copy(d.glow);
    (this.skyMat.uniforms.uSunDir.value as THREE.Vector3).copy(d.sunPos).normalize();
    (this.sunMesh.material as THREE.MeshBasicMaterial).color.copy(d.sunColor);
    this.sunMesh.position.copy(d.sunPos);
    this.fog.color.copy(d.fog);
    this.fog.near = d.fogNear;
    this.fog.far = d.fogFar;
    this.sunLight.color.copy(d.sunLightColor);
    this.sunLight.intensity = d.sunLightIntensity;
    this.sunLight.position.copy(d.lightPos);
    this.hemi.color.copy(d.hemiSky);
    this.hemi.groundColor.copy(d.hemiGround);
    this.hemi.intensity = d.hemiIntensity;
    this.rim.intensity = d.rimIntensity;
    this.starMat.opacity = d.starOpacity;
  }

  /**
   * Advance the atmosphere cross-fade and the daytime sun arc, and drift the
   * fireflies near the player. Call once per frame from the game loop.
   */
  update(dt: number, playerPos?: THREE.Vector3): void {
    if (this.fadeT < 1) {
      this.fadeT = Math.min(1, this.fadeT + dt / ATMO_FADE);
      const e = this.fadeT * this.fadeT * (3 - 2 * this.fadeT); // smoothstep
      lerpAtmo(this.disp, this.from, this.to, e);
      // First leg of a day↔night change just landed on sunset: start the second.
      if (this.fadeT >= 1 && this.pendingMode !== null) {
        const target = this.pendingMode;
        this.pendingMode = null;
        this.beginFade(target, true);
      }
    }

    // Daytime sun sweeps across the sky so its shadows track realistically.
    // The arc is blended in by how "day" we currently are, so it eases in during
    // the sunrise transition and the sun/light snapshot stays continuous.
    const dayWeight =
      this.mode === 'day' ? this.fadeT : this.prevMode === 'day' ? 1 - this.fadeT : 0;
    if (dayWeight > 0.001) {
      this.sunAngle += dt * 0.03;
      const a = this.sunAngle;
      // East (+x) to west (-x), rising and setting near the horizon.
      const discDir = new THREE.Vector3(Math.cos(a), Math.max(0.12, Math.sin(a)), -0.55).normalize();
      const lightDir = new THREE.Vector3(Math.cos(a), Math.max(0.35, Math.sin(a)) + 0.4, -0.5).normalize();
      this.disp.sunPos.copy(discDir).multiplyScalar(800).lerp(this.to.sunPos, 1 - dayWeight);
      this.disp.lightPos.copy(lightDir).multiplyScalar(60).lerp(this.to.lightPos, 1 - dayWeight);
    }

    this.applyAtmo();

    // Twinkle the stars a touch (only visible when faded in).
    if (this.disp.starOpacity > 0.01) {
      this.starMat.opacity = this.disp.starOpacity * (0.75 + 0.25 * Math.sin(performance.now() * 0.002));
    }

    // Fireflies wander in a ring around the player, fading with night weight.
    if (this.fireflies) {
      const visible = this.disp.fireflyOpacity > 0.01;
      this.fireflies.visible = visible;
      if (visible) {
        const px = playerPos?.x ?? 0;
        const pz = playerPos?.z ?? 0;
        const py = playerPos?.y ?? 0;
        const t = performance.now() * 0.001;
        this.fireflies.children.forEach((child, i) => {
          const d = this.fireflyData[i];
          d.angle += dt * d.speed;
          const sprite = child as THREE.Sprite;
          sprite.position.set(
            px + Math.cos(d.angle) * d.radius,
            py + d.y + Math.sin(t * 1.3 + d.phase) * 0.6,
            pz + Math.sin(d.angle) * d.radius
          );
          // Gentle blink.
          (sprite.material as THREE.SpriteMaterial).opacity =
            this.disp.fireflyOpacity * (0.4 + 0.6 * Math.abs(Math.sin(t * 2 + d.phase)));
        });
      }
    }
  }

  private buildTerrain(): void {
    const size = 600;
    const segs = 128;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors: number[] = [];
    const warm = new THREE.Color(0x7d9b52);
    const cool = new THREE.Color(0x55794a);
    const tint = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);
      // Slight color variation with height + sunward warmth.
      tint.lerpColors(cool, warm, Math.min(1, y / 3 + 0.45 + 0.1 * Math.sin(x * 0.11) * Math.cos(z * 0.13)));
      colors.push(tint.r, tint.g, tint.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  private buildMountains(rand: () => number): void {
    // A ring of low-poly cones on the horizon.
    const mat = new THREE.MeshLambertMaterial({ color: 0x5a4a78, flatShading: true });
    const snowMat = new THREE.MeshLambertMaterial({ color: 0xf2e6ff, flatShading: true });
    const group = new THREE.Group();
    const count = 42;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand() * 0.12;
      const dist = 380 + rand() * 120;
      const height = 60 + rand() * 90;
      const radius = 45 + rand() * 55;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 5 + Math.floor(rand() * 3)), mat);
      cone.position.set(Math.cos(angle) * dist, height / 2 - 6, Math.sin(angle) * dist);
      cone.rotation.y = rand() * Math.PI;
      group.add(cone);
      if (height > 105) {
        const cap = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.32, height * 0.3, 5), snowMat);
        cap.position.copy(cone.position);
        cap.position.y = height - height * 0.15 - 6;
        cap.rotation.y = cone.rotation.y;
        group.add(cap);
      }
    }
    this.scene.add(group);
  }

  private buildGrass(rand: () => number): void {
    // Instanced grass tufts: crossed planes with a green gradient.
    const blade = new THREE.PlaneGeometry(0.9, 1.1);
    blade.translate(0, 0.55, 0);
    const mat = new THREE.MeshLambertMaterial({
      color: 0x6f9c4e,
      side: THREE.DoubleSide,
      alphaTest: 0.5,
      map: makeGrassTexture(),
    });
    const count = 2600;
    const mesh = new THREE.InstancedMesh(blade, mat, count * 2);
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = 6 + Math.pow(rand(), 0.6) * 190;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const y = this.heightAt(x, z);
      const scale = 0.7 + rand() * 0.9;
      for (let j = 0; j < 2; j++) {
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, rand() * Math.PI, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
  }

  private buildClouds(rand: () => number): void {
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffd9b8,
      transparent: true,
      opacity: 0.85,
      flatShading: true,
    });
    for (let i = 0; i < 10; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(rand() * 4);
      for (let p = 0; p < puffs; p++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(8 + rand() * 9, 1), mat);
        puff.position.set((p - puffs / 2) * 11 + rand() * 5, rand() * 4, rand() * 6);
        puff.scale.y = 0.55;
        cloud.add(puff);
      }
      const angle = rand() * Math.PI * 2;
      const dist = 180 + rand() * 220;
      cloud.position.set(Math.cos(angle) * dist, 70 + rand() * 50, Math.sin(angle) * dist);
      this.scene.add(cloud);
    }
  }
}

function makeGrassTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);
  // A few tapered blades.
  for (let i = 0; i < 5; i++) {
    const x = 8 + i * 12;
    const lean = (Math.sin(i * 2.3) * 8) | 0;
    const grad = ctx.createLinearGradient(0, 64, 0, 0);
    grad.addColorStop(0, '#4a7038');
    grad.addColorStop(1, '#9cc46a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - 4, 64);
    ctx.quadraticCurveTo(x - 2, 28, x + lean, 4 + (i % 3) * 6);
    ctx.quadraticCurveTo(x + 2, 28, x + 4, 64);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
