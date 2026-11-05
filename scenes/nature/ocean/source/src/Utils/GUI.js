/**
 * GUI.js
 * -----------------------------------------------------------------------------
 * lil-gui control panel. Mirrors the folder structure in the brief and routes
 * changes to the renderer through a small set of callbacks so the GUI stays
 * decoupled from the simulation internals.
 *
 * callbacks:
 *   onSpectrum()   sea-state changed → rebuild static FFT spectrum (CPU)
 *   onGerstner()   swell params changed → rebuild Gerstner uniforms
 *   onMaterial()   shading/color/light changed → push uniforms
 *   onMesh()       mesh resolution / size changed → rebuild geometry
 *   onFFTSize(n)   FFT resolution changed → reallocate solver
 *   onPreset(name) quality preset selected
 *   onLoadHDRI(file) user picked an .hdr file
 *   onClearHDRI()
 * -----------------------------------------------------------------------------
 */

import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { SPECTRA, QUALITY_PRESETS } from '../config.js';

export function createGUI(config, callbacks) {
  const gui = new GUI({ title: 'Ultra-Realistic Ocean' });
  const cb = (name) => () => callbacks[name] && callbacks[name]();

  // ── OCEAN ──────────────────────────────────────────────────────────────────
  const ocean = gui.addFolder('Ocean');
  ocean.add(config.ocean, 'spectrum', Object.values(SPECTRA)).name('Spectrum').onChange(cb('onSpectrum'));

  const wind = ocean.addFolder('Wind');
  wind.add(config.ocean, 'windSpeed', 0.5, 35, 0.1).name('Wind Speed').onChange(cb('onSpectrum'));
  wind.add(config.ocean, 'windDirection', 0, 360, 1).name('Wind Direction').onChange(cb('onSpectrum'));
  wind.add(config.ocean, 'fetch', 1000, 500000, 1000).name('Fetch (m)').onChange(cb('onSpectrum'));
  wind.add(config.ocean, 'windAlignment', 1, 12, 0.1).name('Alignment').onChange(cb('onSpectrum'));

  const waves = ocean.addFolder('Waves');
  waves.add(config.ocean, 'waveAmplitude', 0, 3, 0.01).name('Amplitude').onChange(cb('onSpectrum'));
  waves.add(config.ocean, 'waveLength', 0, 2, 0.01).name('Wave Length').onChange(cb('onSpectrum'));
  waves.add(config.ocean, 'steepness', 0, 2, 0.01).name('Steepness').onChange(cb('onGerstner'));
  waves.add(config.ocean, 'waveSpeed', 0, 3, 0.01).name('Wave Speed').onChange(cb('onGerstner'));
  waves.add(config.ocean, 'randomness', 0, 2, 0.01).name('Randomness').onChange(cb('onSpectrum'));

  const chop = ocean.addFolder('Choppiness');
  chop.add(config.ocean, 'choppiness', 0, 3, 0.01).name('Choppiness').onChange(cb('onMaterial'));

  const swell = ocean.addFolder('Swell');
  swell.add(config.ocean, 'swell', 0, 2, 0.01).name('Primary Swell').onChange(cb('onGerstner'));
  swell.add(config.ocean, 'swellDirection', 0, 360, 1).name('Swell Dir').onChange(cb('onGerstner'));
  swell.add(config.ocean, 'secondarySwell', 0, 2, 0.01).name('Secondary Swell').onChange(cb('onGerstner'));
  swell.add(config.ocean, 'secondarySwellDirection', 0, 360, 1).name('Secondary Dir').onChange(cb('onGerstner'));

  const fft = ocean.addFolder('FFT Settings');
  fft.add(config.ocean, 'patchSize', 40, 600, 1).name('Patch Size (m)').onChange(cb('onSpectrum'));
  fft.add(config.ocean, 'oceanScale', 0.2, 3, 0.01).name('Ocean Scale').onChange(cb('onMaterial'));
  fft.add(config.ocean, 'timeScale', 0, 3, 0.01).name('Time Scale');
  fft.add(config.ocean, 'fftSize', [128, 256, 512]).name('FFT Resolution')
     .onChange((v) => callbacks.onFFTSize && callbacks.onFFTSize(parseInt(v, 10)));

  // ── WATER ──────────────────────────────────────────────────────────────────
  const water = gui.addFolder('Water');
  const refl = water.addFolder('Reflection');
  refl.add(config.water, 'reflectionIntensity', 0, 2, 0.01).name('Intensity').onChange(cb('onMaterial'));
  refl.add(config.water, 'reflectionBlur', 0, 1, 0.01).name('Blur').onChange(cb('onMaterial'));
  refl.add(config.water, 'reflectionRoughness', 0, 1, 0.01).name('Roughness').onChange(cb('onMaterial'));
  refl.add(config.water, 'reflectionDistortion', 0, 1, 0.01).name('Distortion').onChange(cb('onMaterial'));

  const refr = water.addFolder('Refraction');
  refr.add(config.water, 'refractionStrength', 0, 1, 0.01).name('Strength').onChange(cb('onMaterial'));
  refr.add(config.water, 'refractionDistortion', 0, 1, 0.01).name('Distortion').onChange(cb('onMaterial'));
  refr.add(config.water, 'waterThickness', 0.2, 10, 0.01).name('Thickness').onChange(cb('onMaterial'));
  refr.add(config.water, 'chromaticOffset', 0, 0.02, 0.0001).name('Chromatic').onChange(cb('onMaterial'));

  const fres = water.addFolder('Fresnel');
  fres.add(config.water, 'fresnelPower', 1, 8, 0.01).name('Power').onChange(cb('onMaterial'));
  fres.add(config.water, 'fresnelBias', 0, 0.5, 0.001).name('Bias').onChange(cb('onMaterial'));
  fres.add(config.water, 'ior', 1.0, 1.8, 0.001).name('IOR').onChange(cb('onMaterial'));

  const rough = water.addFolder('Roughness / Specular');
  rough.add(config.water, 'roughness', 0.001, 0.6, 0.001).name('Roughness').onChange(cb('onMaterial'));
  rough.add(config.water, 'metallic', 0, 1, 0.01).name('Metallic').onChange(cb('onMaterial'));
  rough.add(config.water, 'specular', 0, 4, 0.01).name('Specular').onChange(cb('onMaterial'));
  rough.add(config.water, 'normalScale', 0, 3, 0.01).name('Normal Scale').onChange(cb('onMaterial'));
  rough.add(config.water, 'detailScale', 0, 3, 0.01).name('Detail Scale').onChange(cb('onMaterial'));
  rough.add(config.water, 'microDetail', 0, 2, 0.01).name('Micro Detail').onChange(cb('onMaterial'));
  rough.add(config.water, 'transparency', 0, 1, 0.01).name('Transparency').onChange(cb('onMaterial'));

  // ── FOAM ───────────────────────────────────────────────────────────────────
  const foam = gui.addFolder('Foam');
  foam.add(config.foam, 'intensity', 0, 3, 0.01).name('Intensity').onChange(cb('onMaterial'));
  foam.add(config.foam, 'threshold', 0, 2, 0.01).name('Threshold').onChange(cb('onMaterial'));
  foam.add(config.foam, 'coverage', 0, 1, 0.01).name('Coverage').onChange(cb('onMaterial'));
  foam.add(config.foam, 'speed', 0, 2, 0.01).name('Speed').onChange(cb('onMaterial'));
  foam.add(config.foam, 'scale', 0.2, 8, 0.01).name('Scale').onChange(cb('onMaterial'));
  foam.add(config.foam, 'brightness', 0, 2, 0.01).name('Brightness').onChange(cb('onMaterial'));
  foam.add(config.foam, 'softness', 0.02, 1, 0.01).name('Softness').onChange(cb('onMaterial'));
  foam.add(config.foam, 'contrast', 0.2, 3, 0.01).name('Contrast').onChange(cb('onMaterial'));
  foam.add(config.foam, 'opacity', 0, 1, 0.01).name('Opacity').onChange(cb('onMaterial'));
  foam.add(config.foam, 'crestFoam', 0, 2, 0.01).name('Crest Foam').onChange(cb('onMaterial'));
  foam.add(config.foam, 'persistence', 0, 1, 0.01).name('Persistent').onChange(cb('onMaterial'));

  // ── LIGHTING ─────────────────────────────────────────────────────────────
  const light = gui.addFolder('Lighting');
  const sunPos = light.addFolder('Sun Position');
  sunPos.add(config.lighting, 'sunElevation', -5, 90, 0.1).name('Elevation').onChange(cb('onMaterial'));
  sunPos.add(config.lighting, 'sunAzimuth', 0, 360, 1).name('Azimuth').onChange(cb('onMaterial'));
  light.add(config.lighting, 'sunIntensity', 0, 20, 0.01).name('Intensity').onChange(cb('onMaterial'));
  light.addColor(config.lighting, 'sunColor').name('Sun Color').onChange(cb('onMaterial'));
  light.add(config.lighting, 'envIntensity', 0, 3, 0.01).name('Env Intensity').onChange(cb('onMaterial'));
  light.add(config.lighting, 'cloudiness', 0, 1, 0.01).name('Cloudiness').onChange(cb('onMaterial'));

  // ── COLOR ──────────────────────────────────────────────────────────────────
  const color = gui.addFolder('Color');
  color.addColor(config.color, 'surfaceColor').name('Surface Color').onChange(cb('onMaterial'));
  color.addColor(config.color, 'deepColor').name('Deep Color').onChange(cb('onMaterial'));
  color.addColor(config.color, 'scatterColor').name('Scatter Color').onChange(cb('onMaterial'));
  color.addColor(config.color, 'horizonColor').name('Horizon Color').onChange(cb('onMaterial'));
  color.add(config.color, 'horizonBlend', 0, 2, 0.01).name('Horizon Blend').onChange(cb('onMaterial'));
  color.add(config.color, 'absorption', 0, 4, 0.01).name('Absorption').onChange(cb('onMaterial'));
  color.add(config.color, 'scattering', 0, 4, 0.01).name('Scattering').onChange(cb('onMaterial'));
  color.add(config.color, 'saturation', 0, 2, 0.01).name('Saturation').onChange(cb('onMaterial'));
  color.add(config.color, 'contrast', 0.5, 2, 0.01).name('Contrast').onChange(cb('onMaterial'));
  color.add(config.color, 'brightness', 0.2, 2, 0.01).name('Brightness').onChange(cb('onMaterial'));
  color.add(config.color, 'exposure', 0.1, 3, 0.01).name('Exposure').onChange(cb('onMaterial'));

  // ── SAND FLOOR ──────────────────────────────────────────────────────────────
  const sand = gui.addFolder('Sand Floor');
  sand.add(config.sand, 'depth', 1, 30, 0.1).name('Water Depth (m)').onChange(cb('onMaterial'));
  sand.add(config.sand, 'textureScale', 0.01, 1.0, 0.005).name('Texture Scale').onChange(cb('onMaterial'));
  sand.add(config.sand, 'normalStrength', 0, 3, 0.01).name('Normal Strength').onChange(cb('onMaterial'));
  sand.add(config.sand, 'brightness', 0, 2, 0.01).name('Brightness').onChange(cb('onMaterial'));
  sand.add(config.sand, 'causticIntensity', 0, 2, 0.01).name('Caustic Intensity').onChange(cb('onMaterial'));
  sand.add(config.sand, 'causticScale', 0.05, 1.5, 0.01).name('Caustic Scale').onChange(cb('onMaterial'));
  sand.add(config.sand, 'causticSpeed', 0, 2, 0.01).name('Caustic Speed').onChange(cb('onMaterial'));

  // ── FOG (blueish horizon haze) ──────────────────────────────────────────────
  const fog = gui.addFolder('Horizon Fog');
  fog.addColor(config.fog, 'color').name('Fog Color').onChange(cb('onMaterial'));
  fog.add(config.fog, 'density', 0.0, 0.006, 0.0001).name('Density').onChange(cb('onMaterial'));
  fog.add(config.fog, 'strength', 0, 1, 0.01).name('Strength').onChange(cb('onMaterial'));
  fog.add(config.fog, 'skyAmount', 0, 1, 0.01).name('Sky Band').onChange(cb('onMaterial'));

  // ── PERFORMANCE ─────────────────────────────────────────────────────────────
  const perf = gui.addFolder('Performance');
  perf.add(config.performance, 'preset', Object.keys(QUALITY_PRESETS)).name('Quality Preset')
      .onChange((name) => callbacks.onPreset && callbacks.onPreset(name));
  perf.add(config.ocean, 'meshResolution', 64, 1024, 1).name('Mesh Resolution').onChange(cb('onMesh'));
  perf.add(config.ocean, 'oceanSize', 128, 1200, 1).name('Ocean Size').onChange(cb('onMesh'));

  // ── ENVIRONMENT (HDRI) ──────────────────────────────────────────────────────
  const env = gui.addFolder('Environment (HDRI)');
  const hdriProxy = {
    loadHDRI: () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.hdr,image/vnd.radiance';
      input.onchange = (e) => {
        const file = e.target.files?.[0];
        if (file && callbacks.onLoadHDRI) callbacks.onLoadHDRI(URL.createObjectURL(file));
      };
      input.click();
    },
    clearHDRI: () => callbacks.onClearHDRI && callbacks.onClearHDRI(),
  };
  env.add(hdriProxy, 'loadHDRI').name('Load .hdr…');
  env.add(hdriProxy, 'clearHDRI').name('Use Procedural Sky');

  return gui;
}
