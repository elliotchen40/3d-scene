/**
 * OceanRenderer.js
 * -----------------------------------------------------------------------------
 * Owns the renderable ocean: the displaced surface mesh, the simulation that
 * drives it, the sun DirectionalLight, the sky dome and HDRI environment.
 *
 * The scene/camera/loop live in main.js; this class exposes `group` (to add to
 * the scene), `update(dt)` and the parameter-change hooks the GUI calls.
 * -----------------------------------------------------------------------------
 */

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OceanMaterial } from './OceanMaterial.js';
import { OceanSimulation } from './OceanSimulation.js';
import { SandFloor } from './SandFloor.js';
import { Sky } from '../Utils/Sky.js';

export class OceanRenderer {
  constructor(renderer, config) {
    this.renderer = renderer;
    this.config = config;

    this.group = new THREE.Group();

    this.oceanMaterial = new OceanMaterial(config);
    this.simulation = new OceanSimulation(renderer, config, this.oceanMaterial);

    this._buildMesh();

    // Sun — a real DirectionalLight (the shader reads its direction via config,
    // but the light object is kept so the rig is complete / extensible).
    this.sun = new THREE.DirectionalLight(
      new THREE.Color(config.lighting.sunColor), config.lighting.sunIntensity);
    this.group.add(this.sun);
    this.group.add(this.sun.target);

    this.sand = new SandFloor(config, renderer);
    this.group.add(this.sand.mesh);

    this.sky = new Sky(config);
    this.group.add(this.sky.mesh);

    this.simulation.markSpectrumDirty();
    this.simulation.markGerstnerDirty();
  }

  _buildMesh() {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const size = this.config.ocean.oceanSize;
    const res = this.config.ocean.meshResolution;
    const geo = new THREE.PlaneGeometry(size, size, res, res);
    geo.rotateX(-Math.PI / 2); // lie flat in XZ, normal +Y
    this.mesh = new THREE.Mesh(geo, this.oceanMaterial.material);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  rebuildMesh() { this._buildMesh(); }

  setFFTSize(size) { this.simulation.setFFTSize(size); }

  /** Load a user-supplied HDRI (.hdr equirectangular) for reflections + sky. */
  loadHDRI(url) {
    return new Promise((resolve, reject) => {
      new RGBELoader().load(url, (tex) => {
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = true;
        tex.needsUpdate = true;

        const maxLod = Math.floor(Math.log2(Math.max(tex.image.width, tex.image.height)));
        // Same HDRI drives both the water reflections and the sky dome, so the
        // horizon and the reflected sky always match.
        this.oceanMaterial.setEnvironment(tex, maxLod);
        this.sky.setEnvMap(tex);
        this.envTexture = tex;
        resolve(tex);
      }, undefined, reject);
    });
  }

  clearHDRI() {
    this.oceanMaterial.setEnvironment(null);
    this.sky.setEnvMap(null);
    this.envTexture?.dispose();
    this.envTexture = null;
  }

  attachScene(scene) { this.scene = scene; }

  syncMaterial() {
    this.oceanMaterial.sync();
    this.sky.sync();
    this.sand.sync();
    this.sun.color.set(this.config.lighting.sunColor);
    this.sun.intensity = this.config.lighting.sunIntensity;
  }

  /** Render the scene without the water surface into `target` (refraction). */
  renderRefraction(renderer, scene, camera, target) {
    this.mesh.visible = false;       // hide the water so we capture the sand behind it
    this.sky.setVisible(false);      // keep sky out of the underwater sample
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prev);
    this.mesh.visible = true;
    this.sky.setVisible(true);
    this.oceanMaterial.setRefraction(target.texture, target.width, target.height);
  }

  update(dt, camera) {
    this.simulation.update(dt);
    const sunDir = this.simulation.updateSun();
    this.sun.position.copy(sunDir).multiplyScalar(1000);
    this.sky.setSun(sunDir);
    this.sky.setTime(this.simulation.time);
    this.sand.update(this.simulation.time, camera, sunDir);
    this.oceanMaterial.setSandLevel(this.sand.level);
    this.oceanMaterial.uniforms.uOceanExtent.value = this.config.ocean.oceanSize;

    // Keep the surface centered under the camera, snapped to a grid cell so the
    // vertices don't shimmer as the viewer moves → seamless, endless ocean.
    if (camera) {
      const cell = this.config.ocean.oceanSize / this.config.ocean.meshResolution;
      const ox = Math.round(camera.position.x / cell) * cell;
      const oz = Math.round(camera.position.z / cell) * cell;
      this.oceanMaterial.setModelOffset(ox, oz);
      this.sky.mesh.position.set(camera.position.x, 0, camera.position.z);
    }
  }

  dispose() {
    this.simulation.dispose();
    this.oceanMaterial.dispose();
    this.mesh.geometry.dispose();
    this.envTexture?.dispose();
  }
}
