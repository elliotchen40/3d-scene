import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Drop-a-model-in-the-rain system.
 *
 *  - Loads a default GLB and lets the user import any .glb at runtime.
 *  - Sits the model on the ground plane, centered, with scale/pos/rot controls.
 *  - Injects a "wet surface" shader into every mesh material:
 *      • upward-facing faces darken, gloss up and form rippling puddles
 *        (so flat tops collect water — true for any model, no mesh analysis);
 *      • all wet faces get droplet beading (triplanar, so it works on any
 *        orientation) that reads as crisp shiny specks.
 *  - Emits GPU "deflection" droplets that bounce/run off the model's top.
 *  - Reports its world footprint so the ground can stay dry underneath
 *    (the model blocks the rain).
 *
 * Shares uTime / uWind / uLightning by reference with the rest of the storm.
 */
export function createModelSystem({ scene, camera, sharedUniforms, defaultUrl, onBounds }) {
  const loader = new GLTFLoader();

  // Transform wrapper — user controls live here; the GLB is recentered inside.
  const group = new THREE.Group();
  scene.add(group);
  let current = null; // the loaded GLB scene
  let userVisible = true; // toggled by the "Load Model" switch
  const processed = new Set(); // materials we've already made wet

  /* ---- wet-surface uniforms (shared refs + own knobs) -------------------- */
  const wet = {
    uTime: sharedUniforms.uTime,
    uWind: sharedUniforms.uWind,
    uWetness: { value: 0.85 }, // overall surface wetness
    uTopPuddle: { value: 0.7 }, // how strongly flat tops puddle
    uFlatThreshold: { value: 0.65 }, // normal.y above this counts as "flat top"
    uDropletAmount: { value: 0.6 }, // droplet beading strength
    uDropletScale: { value: 14.0 }, // droplet density
    uWaterDarkness: { value: 0.45 }, // wet-darkening of the albedo
    uPuddleRoughness: { value: 0.05 }, // gloss of standing water
    uRainRipple: { value: 0.04 }, // ripple strength on top puddles
    uRippleScale: { value: 6.0 },
    uRippleSpeed: { value: 1.3 },
    uRippleDensity: { value: 0.2 },
  };

  const WET_HEADER = /* glsl */ `
  #include <common>
  varying vec3 vWorldNormalW;
  varying vec3 vWorldPosW;
  uniform float uTime;
  uniform vec3  uWind;
  uniform float uWetness;
  uniform float uTopPuddle;
  uniform float uFlatThreshold;
  uniform float uDropletAmount;
  uniform float uDropletScale;
  uniform float uWaterDarkness;
  uniform float uPuddleRoughness;
  uniform float uRainRipple;
  uniform float uRippleScale;
  uniform float uRippleSpeed;
  uniform float uRippleDensity;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  // Rain rings (same model as the ground puddles) for flat-top water.
  float rippleField(vec2 uv) {
    vec2 g = floor(uv);
    vec2 f = fract(uv);
    float h = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 id = g + o;
        float r = hash21(id);
        float life = uTime * uRippleSpeed + r;
        float cycle = floor(life);
        float t = fract(life);
        float spawn = step(1.0 - uRippleDensity, hash21(id + cycle * 1.7 + 0.31));
        vec2 c = o + vec2(hash21(id + cycle * 2.3 + 0.11), hash21(id + cycle * 3.7 + 0.83));
        float d = length(f - c);
        float radius = t * 0.7;
        float band = exp(-pow((d - radius) * 10.0, 2.0));
        float env = sin(t * 3.14159);
        h += sin((d - radius) * 50.0) * band * env * spawn;
      }
    }
    return h;
  }

  vec3 puddleRippleNormal(vec2 worldXZ) {
    vec2 drift = uWind.xz * uTime * 0.05;
    vec2 uv = worldXZ * uRippleScale + drift;
    float e = 0.05;
    float h0 = rippleField(uv);
    float hx = rippleField(uv + vec2(e, 0.0));
    float hz = rippleField(uv + vec2(0.0, e));
    vec2 grad = vec2(hx - h0, hz - h0) / e;
    return normalize(vec3(-grad.x * uRainRipple, 1.0, -grad.y * uRainRipple));
  }

  // Rounded water beads in one plane (0 = dry, 1 = on a droplet).
  float dropField(vec2 uv) {
    uv *= uDropletScale;
    vec2 g = floor(uv);
    vec2 f = fract(uv);
    float v = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 id = g + o;
        vec2 c = o + vec2(hash21(id + 0.1), hash21(id + 0.2));
        float rad = 0.16 + 0.22 * hash21(id + 0.3);
        float d = length(f - c);
        v = max(v, smoothstep(rad, rad * 0.4, d));
      }
    }
    return v;
  }

  // Triplanar beads so droplets sit correctly on any surface orientation.
  float dropletMask(vec3 p) {
    vec3 n = abs(vWorldNormalW);
    n /= max(n.x + n.y + n.z, 1e-4);
    float dx = dropField(p.zy);
    float dy = dropField(p.xz);
    float dz = dropField(p.xy);
    return dx * n.x + dy * n.y + dz * n.z;
  }
  `;

  function makeWet(material) {
    if (!material || processed.has(material)) return;
    processed.add(material);

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, wet);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vWorldNormalW;\nvarying vec3 vWorldPosW;'
        )
        .replace(
          '#include <beginnormal_vertex>',
          '#include <beginnormal_vertex>\nvWorldNormalW = normalize(mat3(modelMatrix) * objectNormal);'
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWorldPosW = (modelMatrix * vec4(transformed, 1.0)).xyz;'
        );

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', WET_HEADER)
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float upN = vWorldNormalW.y;
          float wetBase = uWetness * smoothstep(-0.3, 0.6, upN);
          float topMask = smoothstep(uFlatThreshold, min(uFlatThreshold + 0.15, 1.0), upN) * uTopPuddle;
          float beads = dropletMask(vWorldPosW) * uDropletAmount * wetBase;
          float wetAll = clamp(max(wetBase, topMask), 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * (1.0 - uWaterDarkness), wetAll);`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          float gloss = clamp(max(wetBase * 0.7, topMask) + beads, 0.0, 1.0);
          roughnessFactor = mix(roughnessFactor, uPuddleRoughness, gloss);`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          vec3 rN = mix(vec3(0.0, 1.0, 0.0), puddleRippleNormal(vWorldPosW.xz), topMask);
          vec3 rView = normalize((viewMatrix * vec4(rN, 0.0)).xyz);
          normal = normalize(mix(normal, rView, topMask));`
        );
    };
    material.customProgramCacheKey = () => 'wet-model-v1';
    material.needsUpdate = true;
  }

  /* ---- deflection droplets (water bouncing/running off the top) ---------- */
  const SPLASH_MAX = 2000;
  const splashGeo = new THREE.InstancedBufferGeometry();
  splashGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
      3
    )
  );
  splashGeo.setAttribute(
    'uv',
    new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2)
  );
  splashGeo.setIndex([0, 1, 2, 0, 2, 3]);
  {
    const seed = new Float32Array(SPLASH_MAX * 3);
    const phase = new Float32Array(SPLASH_MAX);
    for (let i = 0; i < SPLASH_MAX; i++) {
      seed[i * 3 + 0] = Math.random();
      seed[i * 3 + 1] = Math.random();
      seed[i * 3 + 2] = Math.random();
      phase[i] = Math.random();
    }
    splashGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 3));
    splashGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    // Per-droplet emission point + surface normal, in model-LOCAL space, filled
    // by the top-down flat-surface scan. Transforming happens in the shader via
    // uModelMatrix so moving/rotating the model never needs a re-scan.
    splashGeo.setAttribute(
      'aSpawn',
      new THREE.InstancedBufferAttribute(new Float32Array(SPLASH_MAX * 3), 3)
    );
    splashGeo.setAttribute(
      'aNormal',
      new THREE.InstancedBufferAttribute(new Float32Array(SPLASH_MAX * 3).fill(0), 3)
    );
  }

  const splashUniforms = {
    uTime: sharedUniforms.uTime,
    uLightning: sharedUniforms.uLightning,
    uWind: sharedUniforms.uWind,
    uModelMatrix: { value: new THREE.Matrix4() }, // model-local -> world
    uGravity: { value: 22.0 },
    uSpeed: { value: 2.2 },
    uLife: { value: 0.9 },
    uSize: { value: 0.03 },
    uOpacity: { value: 0.7 },
    uColor: { value: new THREE.Color(0xb4b8bf) }, // linked to rain color in main
  };

  const splashMat = new THREE.ShaderMaterial({
    uniforms: splashUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: /* glsl */ `
      uniform float uTime, uGravity, uSpeed, uLife, uSize;
      uniform vec3  uWind;
      uniform mat4  uModelMatrix;
      attribute vec3  aSeed;
      attribute float aPhase;
      attribute vec3  aSpawn;
      attribute vec3  aNormal;
      varying vec2  vUv;
      varying float vAge;
      void main() {
        vUv = uv;
        float t = mod(uTime + aPhase * uLife, uLife);
        vAge = t / uLife;

        // Bring the impact point + its surface normal into world space so the
        // model can be moved/rotated/scaled freely without re-scanning.
        vec3 spawn = (uModelMatrix * vec4(aSpawn, 1.0)).xyz;
        vec3 nrm = normalize(mat3(uModelMatrix) * aNormal);

        // Deflect a splash up along the surface normal with a tangential spread.
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 base = normalize(nrm + up * 0.35);
        vec3 t1 = normalize(cross(up, base) + vec3(1e-3));
        vec3 t2 = cross(base, t1);
        vec3 spread = (aSeed.x - 0.5) * t1 + (aSeed.y - 0.5) * t2;
        vec3 vel = (base + spread * 0.7) * uSpeed * (0.6 + aSeed.z * 0.8);

        vec3 pos = spawn + vel * t
                 + vec3(0.0, -0.5 * uGravity * t * t, 0.0) // gravity
                 + vec3(uWind.x, 0.0, uWind.z) * t * 0.15; // drift on the wind

        vec4 mv = viewMatrix * vec4(pos, 1.0);
        mv.xy += position.xy * uSize;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity, uLightning;
      uniform vec3  uColor;
      varying vec2  vUv;
      varying float vAge;
      void main() {
        float d = length(vUv - 0.5);
        float dot = smoothstep(0.5, 0.1, d);
        float fade = 1.0 - smoothstep(0.6, 1.0, vAge);
        float a = dot * fade * uOpacity;
        gl_FragColor = vec4(uColor * (1.0 + uLightning * 2.0), a);
      }
    `,
  });

  const splash = new THREE.Mesh(splashGeo, splashMat);
  splash.frustumCulled = false;
  splash.visible = false;
  scene.add(splash);
  const splashParams = { enabled: true, density: 0.4 };
  splashGeo.instanceCount = Math.floor(SPLASH_MAX * splashParams.density);

  /* ---- bounds / placement ---------------------------------------------- */
  const worldBox = new THREE.Box3();
  let flatCount = 0; // how many flat impact points the scan found
  // Object-space footprint half-extents, captured ONCE per model so the
  // rain-shadow box never grows as the model rotates.
  const baseHalf = new THREE.Vector2(0, 0);
  const _inv = new THREE.Matrix4();

  function updateBounds() {
    if (!current) return;
    group.updateMatrixWorld(true);
    worldBox.setFromObject(group);
    splashUniforms.uModelMatrix.value.copy(group.matrixWorld);
    _inv.copy(group.matrixWorld).invert();
    if (onBounds) onBounds({ inv: _inv, half: baseHalf });
  }

  /* ---- top-down scan for flat surfaces (where rain pools & deflects) ----- */
  const raycaster = new THREE.Raycaster();
  const DOWN = new THREE.Vector3(0, -1, 0);

  function scanFlatSurfaces() {
    const spawnAttr = splashGeo.attributes.aSpawn;
    const normAttr = splashGeo.attributes.aNormal;
    flatCount = 0;
    if (!current) {
      splashGeo.instanceCount = 0;
      return;
    }

    group.updateMatrixWorld(true);
    worldBox.setFromObject(group);
    const min = worldBox.min;
    const max = worldBox.max;
    const yTop = max.y + 1.0;
    const invModel = group.matrixWorld.clone().invert();
    const flat = wet.uFlatThreshold.value; // same cutoff the ripples use

    const points = []; // { p: localPos, n: localNormal }
    const GRID = 26;
    const origin = new THREE.Vector3();
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const x = THREE.MathUtils.lerp(min.x, max.x, (i + Math.random()) / GRID);
        const z = THREE.MathUtils.lerp(min.z, max.z, (j + Math.random()) / GRID);
        origin.set(x, yTop, z);
        raycaster.set(origin, DOWN);
        const hits = raycaster.intersectObject(current, true);
        if (!hits.length || !hits[0].face) continue;
        const h = hits[0];
        // World normal of the hit face.
        const nWorld = h.face.normal
          .clone()
          .transformDirection(h.object.matrixWorld)
          .normalize();
        if (nWorld.y < flat) continue; // keep only flat, upward faces
        points.push({
          p: h.point.clone().applyMatrix4(invModel), // store in model-local space
          n: nWorld.clone().transformDirection(invModel).normalize(),
        });
      }
    }

    flatCount = points.length;
    if (flatCount === 0) {
      splashGeo.instanceCount = 0;
      return;
    }

    // Scatter the droplet instances across the found impact points.
    const sa = spawnAttr.array;
    const na = normAttr.array;
    for (let k = 0; k < SPLASH_MAX; k++) {
      const pt = points[(Math.random() * flatCount) | 0];
      sa[k * 3] = pt.p.x;
      sa[k * 3 + 1] = pt.p.y;
      sa[k * 3 + 2] = pt.p.z;
      na[k * 3] = pt.n.x;
      na[k * 3 + 1] = pt.n.y;
      na[k * 3 + 2] = pt.n.z;
    }
    spawnAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    applyDensity();
  }

  function applyDensity() {
    const f = THREE.MathUtils.clamp(splashParams.density, 0, 1);
    splashGeo.instanceCount = flatCount === 0 ? 0 : Math.floor(f * SPLASH_MAX);
  }

  function disposeMaterial(mat) {
    if (!mat) return;
    for (const v of Object.values(mat)) {
      if (v && v.isTexture) v.dispose();
    }
    mat.dispose();
  }

  function setModel(root) {
    if (current) {
      group.remove(current);
      current.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (Array.isArray(o.material)) o.material.forEach(disposeMaterial);
        else disposeMaterial(o.material);
      });
    }
    processed.clear();

    // Recenter on XZ and rest on the ground (y = 0) before user transform.
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box.min.y;
    // Capture the object-space footprint once — used for the rain-shadow box.
    baseHalf.set(size.x * 0.5, size.z * 0.5);

    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (Array.isArray(o.material)) o.material.forEach(makeWet);
      else makeWet(o.material);
    });

    current = root;
    group.add(root);
    splash.visible = true;
    updateBounds();
    scanFlatSurfaces(); // find flat tops -> droplet emission points
  }

  function loadURL(url, onError) {
    loader.load(
      url,
      (gltf) => setModel(gltf.scene),
      undefined,
      (err) => onError && onError(err)
    );
  }

  if (defaultUrl) loadURL(defaultUrl);

  return {
    group,
    wet,
    splashUniforms,
    splashParams,
    /** Load a GLB from a user File object. */
    importFile(file) {
      const url = URL.createObjectURL(file);
      loadURL(url, (e) => console.error('Failed to load GLB:', e));
    },
    setSplashDensity(f) {
      splashParams.density = f;
      applyDensity();
    },
    /** Re-scan the model for flat surfaces (after a flatness-cutoff change). */
    resampleSplash: scanFlatSurfaces,
    /** Call after any transform change so footprint/emitter stay in sync. */
    refreshBounds: updateBounds,
    /** Show/hide the model + its deflection droplets. */
    setVisible(v) {
      userVisible = v;
      group.visible = v;
    },
    update() {
      splash.visible =
        userVisible && splashParams.enabled && flatCount > 0 && !!current;
    },
  };
}
