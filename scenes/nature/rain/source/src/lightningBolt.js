import * as THREE from 'three';

/**
 * Procedural lightning bolt.
 *
 * `strike(origin, impact)` draws a bolt from a start point (inside the cloud) to
 * an impact point (wherever a ray cast downward first hit — floor or model). The
 * channel is a recursive tree: a trunk plus forks that fork again, each thinner
 * and dimmer. It's drawn as camera-facing additive ribbons (real adjustable
 * thickness, glows through bloom), lands with an impact disc + a point light that
 * lights the surface, then flickers and fades.
 */
export function createLightningBolt({ scene, sharedUniforms }) {
  const params = {
    enabled: true,
    thickness: 0.12, // ribbon width (world units)
    glow: 1.6, // HDR brightness multiplier (drives bloom)
    jaggedness: 0.35, // sideways chaos of the channel
    branches: 0.5, // fork probability
    branchDepth: 3, // generations of forks (tree depth)
    impactLight: 80, // point-light intensity at the strike
    duration: 0.22, // seconds the bolt stays visible
  };

  const color = new THREE.Color(0xbcd2ff);
  const MAX_VERTS = 12000;
  const MAX_IDX = 20000;

  /* ---- bolt channel (camera-facing additive HDR ribbons) ---------------- */
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(MAX_VERTS * 3);
  const tangents = new Float32Array(MAX_VERTS * 3);
  const sides = new Float32Array(MAX_VERTS);
  const widths = new Float32Array(MAX_VERTS);
  const bright = new Float32Array(MAX_VERTS);
  const indices = new Uint32Array(MAX_IDX);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aTangent', new THREE.BufferAttribute(tangents, 3));
  geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
  geometry.setAttribute('aWidth', new THREE.BufferAttribute(widths, 1));
  geometry.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uOpacity: { value: 0 },
      uWidth: { value: params.thickness },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uWidth;
      attribute vec3 aTangent;
      attribute float aSide;
      attribute float aWidth;
      attribute float aBright;
      varying float vB;
      varying float vSide;
      void main() {
        vB = aBright;
        vSide = aSide;
        vec3 wp = position;
        vec3 viewDir = normalize(cameraPosition - wp);
        vec3 t = normalize(aTangent);
        vec3 side = normalize(cross(t, viewDir));
        wp += side * (aSide * uWidth * aWidth);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vB;
      varying float vSide;
      void main() {
        float core = smoothstep(1.0, 0.15, abs(vSide));
        gl_FragColor = vec4(uColor * vB * uOpacity * (0.35 + core), 1.0);
      }
    `,
  });

  const boltMesh = new THREE.Mesh(geometry, material);
  boltMesh.frustumCulled = false;
  boltMesh.visible = false;
  scene.add(boltMesh);

  /* ---- ground/surface impact glow --------------------------------------- */
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uOpacity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d);
        gl_FragColor = vec4(uColor * a * a * uOpacity * 3.0, 1.0);
      }
    `,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.frustumCulled = false;
  glow.visible = false;
  scene.add(glow);

  const impactLight = new THREE.PointLight(color.clone(), 0, 60, 2.0);
  scene.add(impactLight);

  /* ---- bolt generation -------------------------------------------------- */
  const _v = new THREE.Vector3();
  const _perp = new THREE.Vector3();
  const _tan = new THREE.Vector3();

  function subdivide(pts, disp, levels) {
    let cur = pts;
    let d = disp;
    for (let l = 0; l < levels; l++) {
      const next = [cur[0]];
      for (let i = 0; i < cur.length - 1; i++) {
        const a = cur[i];
        const b = cur[i + 1];
        const mid = a.clone().lerp(b, 0.5);
        const len = a.distanceTo(b);
        _v.subVectors(b, a).normalize();
        _perp.set(-_v.z, 0, _v.x);
        _perp.applyAxisAngle(_v, Math.random() * Math.PI * 2);
        mid.addScaledVector(_perp, (Math.random() - 0.5) * d * len);
        next.push(mid, b);
      }
      cur = next;
      d *= 0.55;
    }
    return cur;
  }

  let vCount = 0;
  let iCount = 0;

  function addRibbon(pts, brightFactor, widthFactor) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      if (vCount + 2 > MAX_VERTS || iCount + 6 > MAX_IDX) return;
      if (i < n - 1) _tan.subVectors(pts[i + 1], pts[i]).normalize();
      else _tan.subVectors(pts[i], pts[i - 1]).normalize();
      const tipT = n > 1 ? i / (n - 1) : 0;
      const w = widthFactor * (1.0 - 0.8 * tipT);
      const baseV = vCount;
      for (let s = 0; s < 2; s++) {
        positions[vCount * 3] = pts[i].x;
        positions[vCount * 3 + 1] = pts[i].y;
        positions[vCount * 3 + 2] = pts[i].z;
        tangents[vCount * 3] = _tan.x;
        tangents[vCount * 3 + 1] = _tan.y;
        tangents[vCount * 3 + 2] = _tan.z;
        sides[vCount] = s === 0 ? -1 : 1;
        widths[vCount] = w;
        bright[vCount] = brightFactor;
        vCount++;
      }
      if (i < n - 1) {
        indices[iCount++] = baseV;
        indices[iCount++] = baseV + 1;
        indices[iCount++] = baseV + 2;
        indices[iCount++] = baseV + 1;
        indices[iCount++] = baseV + 3;
        indices[iCount++] = baseV + 2;
      }
    }
  }

  // Recursive tree: a jagged segment, then forks that grow from it.
  function grow(start, dir, length, depth, widthFactor, brightFactor) {
    const end = start.clone().addScaledVector(dir, length);
    const jag = params.jaggedness * (1 + (params.branchDepth - depth) * 0.3);
    const pts = subdivide([start.clone(), end], jag, depth >= params.branchDepth ? 5 : 3);
    addRibbon(pts, brightFactor, widthFactor);
    if (depth <= 0) return;
    for (let i = 1; i < pts.length - 1; i++) {
      const t = i / (pts.length - 1);
      if (Math.random() > params.branches * (0.3 + 0.7 * t)) continue;
      const p = pts[i];
      _v.subVectors(pts[i + 1], p).normalize();
      _v.x += (Math.random() - 0.5) * 1.5;
      _v.z += (Math.random() - 0.5) * 1.5;
      _v.y -= 0.3 + Math.random() * 0.5; // bias forks downward
      _v.normalize();
      const clen = length * (0.35 + Math.random() * 0.35);
      grow(p, _v.clone(), clen, depth - 1, widthFactor * 0.55, brightFactor * 0.7);
    }
  }

  function buildBolt(origin, impact) {
    vCount = 0;
    iCount = 0;
    _v.subVectors(impact, origin).normalize();
    grow(origin.clone(), _v.clone(), origin.distanceTo(impact), params.branchDepth, 1.0, 1.0);
    geometry.setDrawRange(0, iCount);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aTangent.needsUpdate = true;
    geometry.attributes.aSide.needsUpdate = true;
    geometry.attributes.aWidth.needsUpdate = true;
    geometry.attributes.aBright.needsUpdate = true;
    geometry.index.needsUpdate = true;
  }

  /* ---- public API ------------------------------------------------------- */
  let life = 0;

  function strike(origin, impact) {
    if (!params.enabled) return;
    buildBolt(origin, impact);
    glow.position.set(impact.x, impact.y + 0.05, impact.z);
    impactLight.position.set(impact.x, impact.y + 1.0, impact.z);
    life = params.duration;
    boltMesh.visible = true;
    glow.visible = true;
  }

  function update(dt) {
    material.uniforms.uWidth.value = params.thickness;
    if (life <= 0) {
      if (boltMesh.visible) {
        boltMesh.visible = false;
        glow.visible = false;
        impactLight.intensity = 0;
      }
      return;
    }
    life -= dt;
    const k = Math.max(life / params.duration, 0);
    const flicker = 0.5 + 0.5 * Math.random();
    const a = k * flicker;
    material.uniforms.uOpacity.value = a * params.glow;
    glowMat.uniforms.uOpacity.value = a;
    impactLight.intensity = a * params.impactLight;
  }

  function setColor(hex) {
    color.set(hex);
    impactLight.color.set(hex);
  }

  return { params, strike, update, setColor };
}
