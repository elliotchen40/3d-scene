/**
 * main.js
 * -----------------------------------------------------------------------------
 * Bootstraps the WebGL2 renderer, camera rig, sky/ocean and GUI, then drives
 * the frame loop. Everything ocean-specific lives in src/Ocean and src/Shaders;
 * this file is only orchestration.
 * -----------------------------------------------------------------------------
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { config, QUALITY_PRESETS } from './config.js';
import { OceanRenderer } from './Ocean/OceanRenderer.js';
import { createGUI } from './Utils/GUI.js';

const app = document.getElementById('app');
const loader = document.getElementById('loader');

// ── Renderer (WebGL2) ─────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.performance.pixelRatioCap));
renderer.setSize(window.innerWidth, window.innerHeight);
// Tone mapping & color grading are done inside the water/sky shaders.
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
app.appendChild(renderer.domElement);

if (!renderer.capabilities.isWebGL2) {
  loader.textContent = 'WebGL2 is required.';
  throw new Error('WebGL2 not available');
}
// Float render targets for the FFT pipeline.
renderer.getContext().getExtension('EXT_color_buffer_float');

// ── Scene & camera ────────────────────────────────────────────────────────────
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  50, window.innerWidth / window.innerHeight, 0.5, 20000);
camera.position.set(45, 22, 75);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.495; // stay above the water
controls.minDistance = 5;
controls.maxDistance = 1200;
controls.target.set(0, 2, 0);

// ── Ocean ─────────────────────────────────────────────────────────────────────
const ocean = new OceanRenderer(renderer, config);
ocean.attachScene(scene);
scene.add(ocean.group);

// Refraction target: the scene (sand sea-bed) captured behind the water surface.
let refractionTarget;
function sizeRefractionTarget() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (refractionTarget) refractionTarget.dispose();
  refractionTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });
}
sizeRefractionTarget();

// ── GUI ───────────────────────────────────────────────────────────────────────
let gui;
const refreshGUI = () => gui?.controllersRecursive().forEach((c) => c.updateDisplay());

const applyPreset = (name) => {
  const p = QUALITY_PRESETS[name];
  if (!p) return;
  config.ocean.fftSize = p.fftSize;
  config.ocean.meshResolution = p.meshResolution;
  config.ocean.oceanSize = p.oceanSize;
  ocean.setFFTSize(p.fftSize);
  ocean.rebuildMesh();
  refreshGUI();
};

gui = createGUI(config, {
  onSpectrum: () => ocean.simulation.markSpectrumDirty(),
  onGerstner: () => ocean.simulation.markGerstnerDirty(),
  onMaterial: () => ocean.syncMaterial(),
  onMesh: () => ocean.rebuildMesh(),
  onFFTSize: (n) => ocean.setFFTSize(n),
  onPreset: applyPreset,
  onLoadHDRI: (url) => {
    loader.classList.remove('hidden');
    loader.textContent = 'Loading HDRI…';
    ocean.loadHDRI(url)
      .then(() => loader.classList.add('hidden'))
      .catch(() => { loader.textContent = 'HDRI failed to load.'; });
  },
  onClearHDRI: () => ocean.clearHDRI(),
});

ocean.syncMaterial();

// ── Resize ──────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  sizeRefractionTarget();
});

// ── Frame loop ──────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let started = false;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 1 / 20); // clamp huge stalls

  ocean.update(dt, camera);
  controls.update();

  // Pass 1: capture the sea-bed behind the water for refraction.
  ocean.renderRefraction(renderer, scene, camera, refractionTarget);
  // Pass 2: full scene to screen.
  renderer.render(scene, camera);

  if (!started) { started = true; loader.classList.add('hidden'); }
}
animate();

// Expose for quick console tinkering.
window.__ocean = { ocean, config, camera, renderer };
