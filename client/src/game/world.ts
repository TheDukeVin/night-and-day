// The sunset world: procedurally generated grassy plains, distant mountains,
// gradient sky, warm lighting and fog. Deterministic per seed.

import * as THREE from 'three';

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
    this.buildTerrain();
    this.buildMountains(rand);
    this.buildGrass(rand);
    this.buildClouds(rand);
  }

  private buildSky(): void {
    // Big inverted sphere with a vertical sunset gradient.
    const geo = new THREE.SphereGeometry(900, 32, 24);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          float h = normalize(vPos).y; // -1 .. 1
          vec3 zenith = vec3(0.17, 0.11, 0.32);   // deep violet
          vec3 mid    = vec3(0.55, 0.27, 0.45);   // dusky rose
          vec3 low    = vec3(0.95, 0.55, 0.42);   // warm orange
          vec3 horizon= vec3(1.00, 0.80, 0.48);   // golden glow
          vec3 c = mix(horizon, low, smoothstep(0.0, 0.12, h));
          c = mix(c, mid, smoothstep(0.10, 0.35, h));
          c = mix(c, zenith, smoothstep(0.30, 0.75, h));
          // Warmer glow toward the sun's direction (negative z).
          float sunward = smoothstep(0.2, 1.0, -normalize(vPos).z) * smoothstep(0.25, 0.0, abs(h));
          c += vec3(0.25, 0.12, 0.02) * sunward;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(geo, mat));

    // The setting sun.
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(28, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xffdf9e })
    );
    sun.position.set(0, 26, -820);
    this.scene.add(sun);

    this.scene.fog = new THREE.Fog(0xe8a06f, 60, 420);
  }

  private buildLights(): void {
    const sunLight = new THREE.DirectionalLight(0xffc98a, 1.6);
    sunLight.position.set(10, 34, -60);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.left = -45;
    sunLight.shadow.camera.right = 45;
    sunLight.shadow.camera.top = 45;
    sunLight.shadow.camera.bottom = -45;
    sunLight.shadow.camera.far = 160;
    sunLight.shadow.bias = -0.0015;
    this.scene.add(sunLight);

    this.scene.add(new THREE.HemisphereLight(0x9a7bd0, 0x4a5d3a, 0.75));
    const rim = new THREE.DirectionalLight(0x8ea6ff, 0.35);
    rim.position.set(-20, 18, 50);
    this.scene.add(rim);
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
