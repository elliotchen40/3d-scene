import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import GUI from 'lil-gui';
import { createRain } from './rain.js';
import { createModelSystem } from './model.js';
import { createPostFX } from './postfx.js';
import { createClouds } from './clouds.js';
import { createLightningBolt } from './lightningBolt.js';

/* -------------------------------------------------------------------------- */
/*  Renderer                                                                   */
/* -------------------------------------------------------------------------- */
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;

/* -------------------------------------------------------------------------- */
/*  Scene & Camera                                                             */
/* -------------------------------------------------------------------------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
// NOTE: fog blends each fragment toward the background by its distance FROM THE
// CAMERA, so a heavy density visibly dims the scene as you zoom out. Kept light
// here (and exposed in the GUI) so zooming doesn't read as a lighting change.
scene.fog = new THREE.FogExp2(0x05060a, 0.007);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);
camera.position.set(6, 20, 32);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI * 0.495; // don't go below the ground
controls.minDistance = 2;
controls.maxDistance = 300;
controls.target.set(0, 0, 0);

/* -------------------------------------------------------------------------- */
/*  Image-based lighting (soft, neutral reflections)                          */
/* -------------------------------------------------------------------------- */
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

/* -------------------------------------------------------------------------- */
/*  Cinematic lighting rig                                                     */
/* -------------------------------------------------------------------------- */
// Key light — warm, hard, casts the shadows.
const keyLight = new THREE.DirectionalLight(0xfff1dd, 3.0);
keyLight.position.set(8, 12, 6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 60;
keyLight.shadow.camera.left = -15;
keyLight.shadow.camera.right = 15;
keyLight.shadow.camera.top = 15;
keyLight.shadow.camera.bottom = -15;
keyLight.shadow.bias = -0.0002;
keyLight.shadow.normalBias = 0.02;
scene.add(keyLight);

// Fill light — cool, soft, lifts the shadows from the opposite side.
const fillLight = new THREE.DirectionalLight(0x4a6cff, 0.6);
fillLight.position.set(-9, 5, -4);
scene.add(fillLight);

// Rim / back light — separates the surface from the background.
const rimLight = new THREE.SpotLight(0xffd9a0, 120, 50, Math.PI * 0.25, 0.4, 1.2);
rimLight.position.set(-6, 8, -10);
rimLight.target.position.set(0, 0, 0);
scene.add(rimLight);
scene.add(rimLight.target);

// Gentle ambient so nothing reads as pure black.
const ambient = new THREE.AmbientLight(0x223044, 0.4);
scene.add(ambient);

/* -------------------------------------------------------------------------- */
/*  Asphalt material (swappable)                                              */
/* -------------------------------------------------------------------------- */
// Each entry only differs by folder + filename prefix; the map suffixes match.
const MATERIALS = {
  'Asphalt 025C': { dir: './Material_1/', prefix: 'Asphalt025C_1K-JPG_' },
  'Asphalt 024A': { dir: './Material_2/', prefix: 'Asphalt024A_1K-JPG_' },
};

const loader = new THREE.TextureLoader();
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

// Rebuilt on every material swap; `applyTextureScale` reads this by reference.
let allMaps = [];

const material = new THREE.MeshStandardMaterial({
  normalMapType: THREE.TangentSpaceNormalMap, // textures are OpenGL (GL) normals
  roughness: 1.0,
  metalness: 0.0,
  aoMapIntensity: 1.0,
  normalScale: new THREE.Vector2(1, 1),
  displacementScale: 0.0, // off by default — turn it up in the GUI
  displacementBias: 0.0,
  // Lets the water puddles catch crisp environment reflections.
  envMapIntensity: 1.0,
});

const matSettings = { active: 'Asphalt 025C' };

// Loads a material set, disposes the previous textures, and rewires the maps.
function loadMaterial(key) {
  const { dir, prefix } = MATERIALS[key];
  const make = (suffix, srgb = false) => {
    const tex = loader.load(dir + prefix + suffix + '.jpg');
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = maxAnisotropy;
    return tex;
  };

  for (const m of allMaps) m.dispose(); // free the old GPU textures

  material.map = make('Color', true); // sRGB; the rest are linear data maps
  material.aoMap = make('AmbientOcclusion');
  material.roughnessMap = make('Roughness');
  material.normalMap = make('NormalGL');
  material.displacementMap = make('Displacement');
  material.needsUpdate = true;

  allMaps = [
    material.map,
    material.aoMap,
    material.roughnessMap,
    material.normalMap,
    material.displacementMap,
  ];
  applyTextureScale(params.textureScale); // re-apply current tiling
}

/* -------------------------------------------------------------------------- */
/*  Shared uniforms (rain, ripples & lightning stay in lockstep)               */
/* -------------------------------------------------------------------------- */
//  These objects are shared *by reference* between the rain material and the
//  puddle shader, so updating one place drives the whole storm.
const shared = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector3(3, 0, 1) }, // horizontal wind (x, _, z)
  uLightning: { value: 0 }, // 0..1 flash energy
};

/* -------------------------------------------------------------------------- */
/*  Water puddle system (noise-driven wet mask + rain ripples)                 */
/* -------------------------------------------------------------------------- */
//  A procedural FBM noise mask in world space decides where the road is wet.
//  Inside a puddle we override the asphalt: drop roughness to near-mirror,
//  darken the albedo, and replace the normal with animated rain ripples — so
//  the same surface blends from dry asphalt to rippling, reflective water.
const puddleUniforms = {
  uPuddleScale: { value: 0.18 }, // noise frequency (smaller = bigger puddles)
  uPuddleSeed: { value: new THREE.Vector2(13.7, 4.2) }, // pan the noise field
  uPuddleCoverage: { value: 0.52 }, // 0 = bone dry, 1 = flooded
  uPuddleEdge: { value: 0.06 }, // shoreline softness
  uPuddleRoughness: { value: 0.04 }, // water reflection roughness
  uWaterDarkness: { value: 0.55 }, // how much water darkens the asphalt
  // Rain ripples on the water surface.
  uTime: shared.uTime,
  uWind: shared.uWind,
  uRainRipple: { value: 0.04 }, // ripple strength (0 = glassy still water)
  uRippleScale: { value: 2.2 }, // ring size / grid resolution
  uRippleSpeed: { value: 1.3 }, // how fast rings spawn & expand
  uRippleDensity: { value: 0.2 }, // fraction of cells that spawn a ring
  uRippleFalloff: { value: 0.45 }, // min wetness before ripples appear (deep water)
  // Rain-shadow: the model blocks rain, keeping the ground dry beneath it.
  // The footprint is an ORIENTED box: we map ground points into model space via
  // the inverse model matrix, so it rotates/scales with the model instead of
  // recomputing an ever-growing world AABB.
  uModelInv: { value: new THREE.Matrix4() },
  uModelHalfLocal: { value: new THREE.Vector2(0, 0) }, // object-space half extents (fixed at load)
  uModelShadow: { value: 0.0 }, // 0 = no dry patch, 1 = fully dry under model (off until a model is loaded)
};

const PUDDLE_HEADER = /* glsl */ `
#include <common>
varying vec3 vWorldPosition;
uniform float uPuddleScale;
uniform vec2  uPuddleSeed;
uniform float uPuddleCoverage;
uniform float uPuddleEdge;
uniform float uPuddleRoughness;
uniform float uWaterDarkness;
uniform float uTime;
uniform vec3  uWind;
uniform float uRainRipple;
uniform float uRippleScale;
uniform float uRippleSpeed;
uniform float uRippleDensity;
uniform float uRippleFalloff;
uniform mat4  uModelInv;
uniform vec2  uModelHalfLocal;
uniform float uModelShadow;

// --- Ashima 2D simplex noise -------------------------------------------------
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// Fractal Brownian motion for organic, blotchy puddle shapes.
float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amp * snoise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return value;
}

// Returns 0 (dry asphalt) .. 1 (deep water) for a world-space XZ position.
float puddleMaskAt(vec2 worldXZ) {
  vec2 p = worldXZ * uPuddleScale + uPuddleSeed;
  float n = fbm(p) * 0.5 + 0.5;               // -> 0..1
  float threshold = 1.0 - uPuddleCoverage;    // more coverage = lower bar
  return smoothstep(threshold - uPuddleEdge, threshold + uPuddleEdge, n);
}

// --- Rain ripples ------------------------------------------------------------
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

// Concentric rings spawning per grid cell, each with its own phase & lifetime.
float rippleField(vec2 uv) {
  vec2 g = floor(uv);
  vec2 f = fract(uv);
  float h = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 id = g + o;
      float r = hash21(id);                          // per-cell phase offset
      float life = uTime * uRippleSpeed + r;
      float cycle = floor(life);                     // which raindrop (increments over time)
      float t = fract(life);                         // 0..1 progress of this drop
      // Re-roll every cycle so each drop lands in a new spot and density is
      // respected probabilistically over time instead of fixed per cell.
      float roll = hash21(id + cycle * 1.7 + 0.31);
      float spawn = step(1.0 - uRippleDensity, roll);
      vec2 c = o + vec2(hash21(id + cycle * 2.3 + 0.11),
                        hash21(id + cycle * 3.7 + 0.83));
      float d = length(f - c);
      float radius = t * 0.7;                         // ring expands outward
      float band = exp(-pow((d - radius) * 10.0, 2.0));
      float env = sin(t * 3.14159);                  // fade ring in & out
      h += sin((d - radius) * 50.0) * band * env * spawn;
    }
  }
  return h;
}

// World-space "up" vector perturbed by ripples (reduces to flat when ripple=0).
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
`;

material.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, puddleUniforms);

  // Carry world position into the fragment stage.
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vWorldPosition;'
    )
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;'
    );

  shader.fragmentShader = shader.fragmentShader
    // Inject noise helpers + uniforms (keeps the original <common> include).
    .replace('#include <common>', PUDDLE_HEADER)
    // Compute the mask once and darken the albedo where it's wet.
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      float puddleMask = puddleMaskAt(vWorldPosition.xz);
      // Dry patch where the model shelters the ground — tested in MODEL space so
      // the footprint rotates/scales with the model (no growing AABB).
      vec2 lp = (uModelInv * vec4(vWorldPosition, 1.0)).xz;
      vec2 md = abs(lp) - uModelHalfLocal;
      float under = (1.0 - smoothstep(0.0, 0.5, max(md.x, md.y))) * step(0.001, uModelHalfLocal.x);
      puddleMask *= 1.0 - under * uModelShadow;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * (1.0 - uWaterDarkness), puddleMask);`
    )
    // Water is smooth: blend roughness toward a near-mirror value.
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, uPuddleRoughness, puddleMask);`
    )
    // Replace the asphalt normal with animated rain ripples inside puddles.
    // Like a real puddle, ripples are damped in the shallow shoreline film and
    // only build up with depth. Falloff sets how deep before ripples start;
    // a softer puddle edge = wider shallow margin = wider ripple fade-in band.
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      float rippleFade = clamp(uPuddleEdge * 3.0, 0.02, 0.8);
      float deepWater = smoothstep(uRippleFalloff, min(uRippleFalloff + rippleFade, 1.0), puddleMask);
      vec3 rippleN = mix(vec3(0.0, 1.0, 0.0), puddleRippleNormal(vWorldPosition.xz), deepWater);
      vec3 rippleView = normalize((viewMatrix * vec4(rippleN, 0.0)).xyz);
      normal = normalize(mix(normal, rippleView, puddleMask));`
    );
};
// Distinct cache key so this program isn't shared with a plain StandardMaterial.
material.customProgramCacheKey = () => 'asphalt-puddle-v1';

/* -------------------------------------------------------------------------- */
/*  Plane                                                                      */
/* -------------------------------------------------------------------------- */
// Segments give the displacement map something to push around.
const geometry = new THREE.PlaneGeometry(20, 20, 256, 256);
// aoMap reads from the 2nd UV set — reuse the existing UVs.
geometry.setAttribute('uv1', geometry.attributes.uv);

const plane = new THREE.Mesh(geometry, material);
plane.rotation.x = -Math.PI / 2;
plane.receiveShadow = true;
plane.castShadow = true;
scene.add(plane);

/* -------------------------------------------------------------------------- */
/*  Rain                                                                       */
/* -------------------------------------------------------------------------- */
const rain = createRain({ camera, sharedUniforms: shared });
scene.add(rain.mesh);

/* -------------------------------------------------------------------------- */
/*  Model (default GLB + user import)                                          */
/* -------------------------------------------------------------------------- */
const model = createModelSystem({
  scene,
  camera,
  sharedUniforms: shared,
  defaultUrl: './old_rusty_car_2.glb',
  // Feed the model footprint to the ground shader so it stays dry underneath.
  onBounds: (b) => {
    puddleUniforms.uModelInv.value.copy(b.inv);
    puddleUniforms.uModelHalfLocal.value.copy(b.half);
  },
});

// Deflected droplets share the rain's color so they stay visually consistent.
model.splashUniforms.uColor.value = rain.uniforms.uColor.value;

/* -------------------------------------------------------------------------- */
/*  Volumetric clouds                                                          */
/* -------------------------------------------------------------------------- */
const clouds = createClouds({ scene, camera, sharedUniforms: shared, sun: keyLight });

/* -------------------------------------------------------------------------- */
/*  Lightning bolt (strikes down from the cloud)                               */
/* -------------------------------------------------------------------------- */
const bolt = createLightningBolt({ scene, sharedUniforms: shared });
const _boltRay = new THREE.Raycaster();
const _boltDown = new THREE.Vector3(0, -1, 0);
const _boltBox = new THREE.Box3();
const _boltOrigin = new THREE.Vector3();

// Fire a bolt from a random point in the cloud, down onto whatever's below
// (the floor or the imported model).
function fireBolt() {
  if (!cloudState.enabled || !bolt.params.enabled) return;
  clouds.mesh.updateMatrixWorld();
  _boltBox.setFromObject(clouds.mesh);
  _boltOrigin.set(
    THREE.MathUtils.lerp(_boltBox.min.x, _boltBox.max.x, 0.2 + Math.random() * 0.6),
    THREE.MathUtils.lerp(_boltBox.min.y, _boltBox.max.y, 0.5), // middle of the cloud
    THREE.MathUtils.lerp(_boltBox.min.z, _boltBox.max.z, 0.2 + Math.random() * 0.6)
  );
  _boltRay.set(_boltOrigin, _boltDown);
  const targets = [plane];
  if (model.group.visible) targets.push(model.group);
  const hits = _boltRay.intersectObjects(targets, true);
  const impact = hits.length
    ? hits[0].point.clone()
    : new THREE.Vector3(_boltOrigin.x, 0, _boltOrigin.z);
  bolt.strike(_boltOrigin, impact);
}

/* -------------------------------------------------------------------------- */
/*  Wind                                                                       */
/* -------------------------------------------------------------------------- */
const wind = {
  strength: 3.0, // horizontal speed (world units / s)
  direction: 20, // degrees around Y
};
function applyWind() {
  const a = THREE.MathUtils.degToRad(wind.direction);
  shared.uWind.value.set(
    Math.cos(a) * wind.strength,
    0,
    Math.sin(a) * wind.strength
  );
}
applyWind();

/* -------------------------------------------------------------------------- */
/*  Lightning                                                                  */
/* -------------------------------------------------------------------------- */
//  A flash drives a real directional light (so it actually illuminates the
//  scene and glints off the puddles), a scene-color flash, and the shared
//  uLightning energy that brightens the rain streaks.
const lightningLight = new THREE.DirectionalLight(0xdfe8ff, 0);
lightningLight.position.set(-4, 16, 8);
scene.add(lightningLight);

const baseBackground = scene.background.clone();
const baseFog = scene.fog.color.clone();
const flashColor = new THREE.Color(0x8fa8d8);

const lightning = {
  enabled: true,
  frequency: 8, // average strikes per minute
  intensity: 6.0, // peak brightness of the bolt
  volume: 0.7, // thunder clap volume
};

// Thunder clap — fired on every strike (gated by the master Sound toggle).
const lightningAudio = new Audio('./sounds/lightning.mp3');

let flash = 0; // current 0..1 flash energy
let nextStrikeIn = 2.0; // seconds until the next bolt
const pendingFlickers = []; // queued sub-flashes of a single strike

function scheduleNextStrike() {
  const perSecond = Math.max(lightning.frequency, 0.001) / 60;
  // Exponential gap so strikes feel random, not metronomic.
  nextStrikeIn = -Math.log(1 - Math.random()) / perSecond;
}

function triggerStrike() {
  // A bolt is 2–3 quick flickers.
  const flickers = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < flickers; i++) {
    pendingFlickers.push({
      delay: i * (0.04 + Math.random() * 0.07),
      power: i === 0 ? 1.0 : 0.4 + Math.random() * 0.5,
    });
  }
  fireBolt(); // visible bolt striking down from the cloud
  // Thunder, in sync with the flash. Let a clap play out fully — only start a
  // new one once the previous has finished (don't cut it off mid-roll).
  if (sound.enabled && lightningAudio.paused) {
    lightningAudio.volume = THREE.MathUtils.clamp(lightning.volume, 0, 1);
    lightningAudio.currentTime = 0;
    lightningAudio.play().catch(() => {});
  }
}

function updateLightning(dt) {
  if (!lightning.enabled) {
    flash = 0;
  } else {
    nextStrikeIn -= dt;
    if (nextStrikeIn <= 0) {
      triggerStrike();
      scheduleNextStrike();
    }
    for (let i = pendingFlickers.length - 1; i >= 0; i--) {
      pendingFlickers[i].delay -= dt;
      if (pendingFlickers[i].delay <= 0) {
        flash = Math.max(flash, pendingFlickers[i].power);
        pendingFlickers.splice(i, 1);
      }
    }
    flash = Math.max(0, flash - dt * 6.0); // fast exponential-ish decay
  }

  shared.uLightning.value = flash;
  lightningLight.intensity = flash * lightning.intensity;
  scene.background.copy(baseBackground).lerp(flashColor, flash * 0.85);
  scene.fog.color.copy(baseFog).lerp(flashColor, flash * 0.6);
}

/* -------------------------------------------------------------------------- */
/*  Cinematic post-processing & camera                                         */
/* -------------------------------------------------------------------------- */
const fx = createPostFX({ renderer, scene, camera });

const cine = {
  autoOrbit: true,
  orbitSpeed: 1.1,
  fov: 18,
  letterbox: true,
};
controls.autoRotate = cine.autoOrbit;
controls.autoRotateSpeed = cine.orbitSpeed;
camera.fov = cine.fov;
camera.updateProjectionMatrix();

// Letterbox bars (CSS overlay).
const barTop = document.getElementById('bar-top');
const barBottom = document.getElementById('bar-bottom');
function applyLetterbox() {
  const h = cine.letterbox ? '8vh' : '0';
  barTop.style.height = h;
  barBottom.style.height = h;
}
applyLetterbox();

// --- Focus-plane visualizer (Unreal-style) ---------------------------------
// A translucent grid plane shown at the DoF focus distance while the user drags
// the Focus Distance slider, then it fades out on its own.
const focusPlaneMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  uniforms: {
    uOpacity: { value: 0 },
    uColor: { value: new THREE.Color(0xf4b063) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uOpacity;
    uniform vec3  uColor;
    varying vec2  vUv;
    void main() {
      vec2 grid = abs(fract(vUv * 12.0) - 0.5);
      vec2 d = grid / fwidth(vUv * 12.0);
      float line = 1.0 - clamp(min(d.x, d.y), 0.0, 1.0);
      vec2 c = abs(vUv - 0.5);
      float cross = step(c.x, 0.0015) + step(c.y, 0.0015); // center crosshair
      float a = (line * 0.55 + 0.05 + cross * 0.9) * uOpacity;
      if (a <= 0.001) discard;
      gl_FragColor = vec4(uColor, a);
    }
  `,
});
const focusPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), focusPlaneMat);
focusPlane.frustumCulled = false;
focusPlane.visible = false;
scene.add(focusPlane);

let focusTimer = 0;
const _focusDir = new THREE.Vector3();
function showFocusPlane() {
  focusTimer = 1.2; // seconds visible after the last change
  focusPlane.visible = true;
}
function updateFocusPlane(dt) {
  if (focusTimer <= 0) {
    if (focusPlane.visible) focusPlane.visible = false;
    return;
  }
  focusTimer -= dt;
  const dist = fx.bokeh.uniforms.focus.value;
  camera.getWorldDirection(_focusDir);
  focusPlane.position.copy(camera.position).addScaledVector(_focusDir, dist);
  focusPlane.quaternion.copy(camera.quaternion); // face the camera
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
  const halfW = halfH * camera.aspect;
  focusPlane.scale.set(halfW * 2 * 0.92, halfH * 2 * 0.92, 1);
  focusPlaneMat.uniforms.uOpacity.value = 0.9 * Math.min(1, focusTimer / 0.4);
}

/* -------------------------------------------------------------------------- */
/*  GUI controls                                                               */
/* -------------------------------------------------------------------------- */
const params = {
  textureScale: 4, // tiles across the plane
  normalIntensity: 1.0,
  aoIntensity: 1.0,
  roughnessIntensity: 1.0,
  displacementScale: 0.0,
};

function applyTextureScale(scale) {
  for (const map of allMaps) {
    map.repeat.set(scale, scale);
  }
}

// Initial load — builds the textures and applies the current tiling.
loadMaterial(matSettings.active);

const gui = new GUI({ title: '🎬 Rain Studio' });

// Top-level toggle: load/show the model and reveal all its params.
const appState = { showModel: false };
let fModel; // assigned below; referenced by the toggle
function applyShowModel(v) {
  model.setVisible(v);
  if (fModel) v ? fModel.show() : fModel.hide();
  if (v) {
    model.refreshBounds(); // restore the rain-shadow footprint
    puddleUniforms.uModelShadow.value = 1.0; // enable the car mask with the model
  } else {
    puddleUniforms.uModelHalfLocal.value.set(0, 0); // ground fully exposed to rain
    puddleUniforms.uModelShadow.value = 0.0; // no model -> no dry patch
  }
}
gui.add(appState, 'showModel').name('Load Model').onChange(applyShowModel);
gui.add({ strike: () => triggerStrike() }, 'strike').name('⚡ Strike Now');

const fMat = gui.addFolder('Material');
fMat
  .add(matSettings, 'active', Object.keys(MATERIALS))
  .name('Material')
  .onChange(loadMaterial);
fMat
  .add(params, 'textureScale', 0.5, 20, 0.1)
  .name('Texture Scale')
  .onChange(applyTextureScale);
fMat
  .add(params, 'normalIntensity', 0, 3, 0.01)
  .name('Normal Intensity')
  .onChange((v) => material.normalScale.set(v, v));
fMat
  .add(params, 'aoIntensity', 0, 3, 0.01)
  .name('AO Intensity')
  .onChange((v) => (material.aoMapIntensity = v));
fMat
  .add(params, 'roughnessIntensity', 0, 2, 0.01)
  .name('Roughness Intensity')
  .onChange((v) => (material.roughness = v));
fMat
  .add(params, 'displacementScale', 0, 1, 0.001)
  .name('Displacement')
  .onChange((v) => (material.displacementScale = v));
fMat.close();

const fPud = gui.addFolder('Puddles');
fPud
  .add(puddleUniforms.uPuddleScale, 'value', 0.02, 0.8, 0.001)
  .name('Noise Scale');
fPud
  .add(puddleUniforms.uPuddleSeed.value, 'x', -50, 50, 0.1)
  .name('Seed X')
  .listen();
fPud
  .add(puddleUniforms.uPuddleSeed.value, 'y', -50, 50, 0.1)
  .name('Seed Y')
  .listen();
fPud
  .add(
    {
      randomize: () =>
        puddleUniforms.uPuddleSeed.value.set(
          (Math.random() - 0.5) * 100,
          (Math.random() - 0.5) * 100
        ),
    },
    'randomize'
  )
  .name('🎲 Randomize Seed');
fPud
  .add(puddleUniforms.uPuddleCoverage, 'value', 0, 1, 0.01)
  .name('Coverage');
fPud
  .add(puddleUniforms.uPuddleEdge, 'value', 0.001, 0.3, 0.001)
  .name('Edge Softness');
fPud
  .add(puddleUniforms.uPuddleRoughness, 'value', 0, 0.5, 0.001)
  .name('Reflection Roughness');
fPud
  .add(puddleUniforms.uWaterDarkness, 'value', 0, 1, 0.01)
  .name('Water Darkness');
fPud
  .add(puddleUniforms.uRainRipple, 'value', 0, 2, 0.01)
  .name('Rain Ripples');
fPud
  .add(puddleUniforms.uRippleScale, 'value', 0.2, 8, 0.01)
  .name('Ripple Scale');
fPud
  .add(puddleUniforms.uRippleSpeed, 'value', 0, 4, 0.01)
  .name('Ripple Speed');
fPud
  .add(puddleUniforms.uRippleDensity, 'value', 0, 1, 0.01)
  .name('Ripple Density');
fPud
  .add(puddleUniforms.uRippleFalloff, 'value', 0, 1, 0.01)
  .name('Ripple Falloff');
fPud.close();

const rainParams = { density: 0.4 };

// Rain ambience — volume tracks rain density (full volume at max density).
const rainAudio = new Audio('./sounds/rainsound.mp3');
rainAudio.loop = true;
const sound = { enabled: true };
function applyRainVolume() {
  rainAudio.volume = THREE.MathUtils.clamp(rainParams.density, 0, 1);
}
applyRainVolume();
function startRainAudio() {
  if (sound.enabled) rainAudio.play().catch(() => {});
}
// Browsers block audio until the first user gesture — kick it off then.
window.addEventListener('pointerdown', startRainAudio, { once: true });
window.addEventListener('keydown', startRainAudio, { once: true });

const fRain = gui.addFolder('Rain');
fRain
  .add(rainParams, 'density', 0, 1, 0.01)
  .name('Density')
  .onChange((v) => {
    rain.setDensity(v);
    applyRainVolume(); // louder rain = louder sound
  });
fRain.add(rain.uniforms.uSpeed, 'value', 2, 60, 0.5).name('Fall Speed');
fRain.add(rain.uniforms.uLength, 'value', 0.2, 4, 0.01).name('Streak Length');
fRain.add(rain.uniforms.uWidth, 'value', 0.002, 0.05, 0.001).name('Streak Width');
fRain.add(rain.uniforms.uOpacity, 'value', 0, 1, 0.01).name('Opacity');
fRain.addColor({ c: '#b4b8bf' }, 'c').name('Color (rain + splash)')
  .onChange((v) => rain.uniforms.uColor.value.set(v));
fRain.add(rain.uniforms.uVolume.value, 'y', 10, 80, 1).name('Fall Height');
fRain
  .add(sound, 'enabled')
  .name('Sound')
  .onChange((v) => (v ? rainAudio.play().catch(() => {}) : rainAudio.pause()));
fRain.close();

const fWind = gui.addFolder('Wind');
fWind.add(wind, 'strength', 0, 25, 0.1).name('Strength').onChange(applyWind);
fWind.add(wind, 'direction', 0, 360, 1).name('Direction °').onChange(applyWind);
fWind.close();

const fBolt = gui.addFolder('Lightning');
fBolt.add(lightning, 'enabled').name('Enabled');
fBolt.add(lightning, 'frequency', 0, 60, 1).name('Strikes / min');
fBolt.add(lightning, 'intensity', 0, 20, 0.1).name('Intensity');
fBolt.add(lightning, 'volume', 0, 1, 0.01).name('Thunder Volume');
fBolt.addColor({ c: '#dfe8ff' }, 'c').name('Bolt Color')
  .onChange((v) => lightningLight.color.set(v));
fBolt.close();

// --- Model ------------------------------------------------------------------
const fileInput = document.getElementById('glb-input');
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) model.importFile(file);
  fileInput.value = ''; // allow re-importing the same file
});

const modelTransform = {
  scale: 1,
  posX: 0,
  posY: 0,
  posZ: 0,
  rotY: 0,
};
function applyModelTransform() {
  model.group.scale.setScalar(modelTransform.scale);
  model.group.position.set(modelTransform.posX, modelTransform.posY, modelTransform.posZ);
  model.group.rotation.y = THREE.MathUtils.degToRad(modelTransform.rotY);
  model.refreshBounds();
}

fModel = gui.addFolder('Model');
fModel.add({ import: () => fileInput.click() }, 'import').name('📂 Import GLB…');
fModel.add(modelTransform, 'scale', 0.05, 10, 0.01).name('Scale').onChange(applyModelTransform).listen();
fModel.add(modelTransform, 'posX', -15, 15, 0.01).name('Position X').onChange(applyModelTransform);
fModel.add(modelTransform, 'posY', -5, 15, 0.01).name('Position Y').onChange(applyModelTransform);
fModel.add(modelTransform, 'posZ', -15, 15, 0.01).name('Position Z').onChange(applyModelTransform);
fModel.add(modelTransform, 'rotY', 0, 360, 1).name('Rotation Y°').onChange(applyModelTransform);

const fWet = fModel.addFolder('Wetness');
fWet.add(model.wet.uWetness, 'value', 0, 1, 0.01).name('Surface Wetness');
fWet.add(model.wet.uWaterDarkness, 'value', 0, 1, 0.01).name('Wet Darkness');
fWet.add(model.wet.uPuddleRoughness, 'value', 0, 0.5, 0.001).name('Reflection Roughness');
fWet.add(model.wet.uDropletAmount, 'value', 0, 1, 0.01).name('Droplet Beading');
fWet.add(model.wet.uDropletScale, 'value', 2, 40, 0.5).name('Droplet Density');
fWet.add(model.wet.uTopPuddle, 'value', 0, 1, 0.01).name('Top Puddles');
fWet
  .add(model.wet.uFlatThreshold, 'value', 0.2, 0.99, 0.01)
  .name('Flatness Cutoff')
  .onChange(() => model.resampleSplash());
fWet.add(model.wet.uRainRipple, 'value', 0, 0.3, 0.001).name('Puddle Ripples');
// Ripple ring size on the model (lower = larger rings, like the ground puddles).
fWet.add(model.wet.uRippleScale, 'value', 1, 20, 0.1).name('Surface Ripple Scale');

const fSplash = fModel.addFolder('Deflection Droplets');
fSplash.add(model.splashParams, 'enabled').name('Enabled');
fSplash.add(model.splashParams, 'density', 0, 1, 0.01).name('Amount').onChange((v) => model.setSplashDensity(v));
fSplash.add(model.splashUniforms.uSpeed, 'value', 0.5, 6, 0.1).name('Bounce Speed');
fSplash.add(model.splashUniforms.uSize, 'value', 0.005, 0.1, 0.001).name('Droplet Size');
fSplash.add(model.splashUniforms.uOpacity, 'value', 0, 1, 0.01).name('Opacity');

fModel.add(puddleUniforms.uModelShadow, 'value', 0, 1, 0.01).name('Rain Shadow').listen();
fModel.close();
applyShowModel(appState.showModel); // hidden by default until toggled on

const fLight = gui.addFolder('Lighting');
fLight.add(renderer, 'toneMappingExposure', 0, 3, 0.01).name('Exposure');
fLight.add(keyLight, 'intensity', 0, 8, 0.01).name('Key');
fLight.add(fillLight, 'intensity', 0, 4, 0.01).name('Fill');
fLight.add(rimLight, 'intensity', 0, 400, 1).name('Rim');
fLight.add(scene, 'environmentIntensity', 0, 2, 0.01).name('Env / IBL');

// Fog — heavier values dim the scene more as the camera pulls back, so keep it
// light (or turn it off) if zooming reads as a lighting change.
const fogState = { enabled: false, density: scene.fog.density };
function applyFog() {
  scene.fog.density = fogState.enabled ? fogState.density : 0;
}
applyFog(); // off by default
fLight.add(fogState, 'enabled').name('Fog').onChange(applyFog);
fLight
  .add(fogState, 'density', 0, 0.03, 0.0005)
  .name('Fog Density')
  .onChange(applyFog);
fLight.close();

// --- Clouds -----------------------------------------------------------------
const cloudState = { enabled: false };
let fThunder; // assigned below; only shown while the cloud is active
function applyCloudEnabled(v) {
  clouds.setVisible(v);
  if (fThunder) v ? fThunder.show() : fThunder.hide();
}
const fCloud = gui.addFolder('Cloud');
fCloud.add(cloudState, 'enabled').name('Enabled').onChange(applyCloudEnabled);
fCloud.add(clouds.mesh.position, 'x', -60, 60, 0.5).name('Position X');
fCloud.add(clouds.mesh.position, 'y', 2, 80, 0.5).name('Position Y');
fCloud.add(clouds.mesh.position, 'z', -60, 60, 0.5).name('Position Z');
fCloud.add(clouds.mesh.rotation, 'y', 0, Math.PI * 2, 0.01).name('Rotation Y');
const cloudSize = { size: 14, height: 9 };
function applyCloudSize() {
  clouds.mesh.scale.set(cloudSize.size, cloudSize.height, cloudSize.size * 0.8);
}
fCloud.add(cloudSize, 'size', 3, 60, 0.5).name('Size').onChange(applyCloudSize);
fCloud.add(cloudSize, 'height', 2, 40, 0.5).name('Height').onChange(applyCloudSize);
fCloud.add(clouds.uniforms.uPuff, 'value', 0, 3, 0.01).name('Puffiness');
fCloud.add(clouds.uniforms.uDensity, 'value', 0, 6, 0.05).name('Density');
fCloud.add(clouds.uniforms.uDetail, 'value', 1, 12, 0.1).name('Detail');
fCloud.add(clouds.uniforms.uSunIntensity, 'value', 0, 6, 0.05).name('Sun Strength');
fCloud.add(clouds.uniforms.uSteps, 'value', 16, 96, 1).name('Quality (steps)');
fCloud.addColor({ c: '#ffffff' }, 'c').name('Color').onChange((v) => clouds.uniforms.uColor.value.set(v));
fCloud
  .add(clouds.uniforms.uSeed.value, 'x', -50, 50, 0.1)
  .name('Seed X')
  .listen();
fCloud
  .add(clouds.uniforms.uSeed.value, 'z', -50, 50, 0.1)
  .name('Seed Z')
  .listen();
fCloud
  .add(
    {
      randomize: () =>
        clouds.uniforms.uSeed.value.set(
          Math.random() * 100 - 50,
          Math.random() * 100 - 50,
          Math.random() * 100 - 50
        ),
    },
    'randomize'
  )
  .name('🎲 Randomize Shape');

// Thunderbolt — strikes down from the cloud onto the floor / model.
fThunder = fCloud.addFolder('Thunderbolt');
fThunder.add(bolt.params, 'enabled').name('Enabled');
fThunder.addColor({ c: '#bcd2ff' }, 'c').name('Color').onChange((v) => bolt.setColor(v));
fThunder.add(bolt.params, 'thickness', 0.01, 1, 0.01).name('Thickness');
fThunder.add(bolt.params, 'glow', 0, 4, 0.05).name('Glow');
fThunder.add(bolt.params, 'jaggedness', 0, 1, 0.01).name('Jaggedness');
fThunder.add(bolt.params, 'branches', 0, 1, 0.01).name('Branchiness');
fThunder.add(bolt.params, 'branchDepth', 0, 5, 1).name('Branch Depth');
fThunder.add(bolt.params, 'impactLight', 0, 300, 1).name('Impact Light');
fThunder.add(bolt.params, 'duration', 0.05, 1, 0.01).name('Duration');
applyCloudEnabled(cloudState.enabled); // hide Thunderbolt until the cloud is on
fCloud.close();

// --- Cinematic --------------------------------------------------------------
const fCine = gui.addFolder('🎬 Cinematic');

const fCam = fCine.addFolder('Camera');
fCam.add(cine, 'autoOrbit').name('Auto Orbit').onChange((v) => (controls.autoRotate = v));
fCam.add(cine, 'orbitSpeed', -3, 3, 0.05).name('Orbit Speed').onChange((v) => (controls.autoRotateSpeed = v));
fCam.add(cine, 'fov', 18, 80, 1).name('Focal / FOV').onChange((v) => {
  camera.fov = v;
  camera.updateProjectionMatrix();
});
fCam.add(cine, 'letterbox').name('Letterbox').onChange(applyLetterbox);

const dofParams = { enabled: false };
fx.bokeh.enabled = dofParams.enabled; // off by default — opt in when framing
const fDof = fCine.addFolder('Depth of Field');
fDof.add(dofParams, 'enabled').name('Enable DoF').onChange((v) => (fx.bokeh.enabled = v));
fDof
  .add(fx.bokeh.uniforms.focus, 'value', 1, 40, 0.1)
  .name('Focus Distance')
  .onChange(showFocusPlane); // flash the focus plane while dragging
fDof.add(fx.bokeh.uniforms.aperture, 'value', 0, 0.004, 0.00005).name('Aperture');
fDof.add(fx.bokeh.uniforms.maxblur, 'value', 0, 0.02, 0.0005).name('Max Blur');

const fFx = fCine.addFolder('Effects');
fFx.add(fx.bloom, 'strength', 0, 2, 0.01).name('Bloom');
fFx.add(fx.bloom, 'radius', 0, 2, 0.01).name('Bloom Radius');
fFx.add(fx.bloom, 'threshold', 0, 1, 0.01).name('Bloom Threshold');
fFx.add(fx.grade.uniforms.uGrain, 'value', 0, 0.25, 0.005).name('Film Grain');
fFx.add(fx.grade.uniforms.uVignette, 'value', 0, 1.5, 0.01).name('Vignette');
fFx.add(fx.grade.uniforms.uChroma, 'value', 0, 0.01, 0.0001).name('Chromatic Aberration');
fFx.add(fx.grade.uniforms.uContrast, 'value', 0.7, 1.6, 0.01).name('Contrast');
fFx.add(fx.grade.uniforms.uSaturation, 'value', 0, 2, 0.01).name('Saturation');
fCine.close();

/* -------------------------------------------------------------------------- */
/*  Resize & render loop                                                       */
/* -------------------------------------------------------------------------- */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  fx.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1); // clamp after tab-switches
  shared.uTime.value += dt;

  controls.update();
  rain.update();
  model.update();
  clouds.update();
  updateLightning(dt);
  bolt.update(dt);
  updateFocusPlane(dt);

  fx.render(dt);
});
