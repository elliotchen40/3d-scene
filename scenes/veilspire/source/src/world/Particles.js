import * as THREE from 'three';

// A small GPU particle pool for world feedback: torch embers, spell flashes,
// impact dust, flight sparks.
//
// It used to live inside combat/SpellSystem.js, but the scene keeps using it
// for things that have nothing to do with combat — the castle torches, the
// classroom candles, the breakable props, the weather. Keeping the pool here
// lets the world layer stand on its own.

const MAX_PARTICLES = 600;

export class Particles {
  constructor(scene) {
    this.scene = scene;

    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMaxLife = new Float32Array(MAX_PARTICLES);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));

    const mat = new THREE.PointsMaterial({
      vertexColors: true, size: 0.16, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    mat.toneMapped = false;

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.pCursor = 0;
    // Park dead particles far underground
    for (let i = 0; i < MAX_PARTICLES; i++) this.pPos[i * 3 + 1] = -9999;
  }

  // Scatters `count` particles from a point, in a random direction.
  spawnBurst(pos, count, speed, color = 0xaadfff, lifeScale = 1) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const idx = this.pCursor;
      this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.3 + Math.random() * 0.7);
      this.pPos[idx * 3] = pos.x;
      this.pPos[idx * 3 + 1] = pos.y;
      this.pPos[idx * 3 + 2] = pos.z;
      this.pVel[idx * 3] = Math.sin(phi) * Math.cos(theta) * s;
      this.pVel[idx * 3 + 1] = Math.abs(Math.cos(phi)) * s * 0.9 + 1.2;
      this.pVel[idx * 3 + 2] = Math.sin(phi) * Math.sin(theta) * s;
      const shade = 0.7 + Math.random() * 0.5;
      this.pCol[idx * 3] = c.r * shade;
      this.pCol[idx * 3 + 1] = c.g * shade;
      this.pCol[idx * 3 + 2] = c.b * shade;
      this.pLife[idx] = this.pMaxLife[idx] = (0.5 + Math.random() * 0.5) * lifeScale;
    }
  }

  update(dt) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        this.pPos[i * 3 + 1] = -9999;
        continue;
      }
      this.pVel[i * 3 + 1] -= 9 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
