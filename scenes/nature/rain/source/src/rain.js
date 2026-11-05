import * as THREE from 'three';

/**
 * Fully procedural, GPU-instanced rain.
 *
 * Every drop is a camera-facing streak quad stretched along its velocity
 * (gravity + wind). Positions are wrapped (mod) inside a volume that follows
 * the camera, so the field is effectively infinite for any number of drops.
 * The whole thing animates from a single `uTime` uniform — no per-frame CPU
 * work beyond updating the camera position.
 *
 * `sharedUniforms` (uTime, uWind, uLightning) are shared by reference with the
 * puddle/ripple shader so rain, ripples and lightning all stay in lockstep.
 */
export function createRain({ camera, sharedUniforms, maxCount = 30000 }) {
  const geometry = new THREE.InstancedBufferGeometry();

  // Base streak quad: x = width axis, y = length axis.
  const positions = new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);

  // Per-drop randoms: a normalized spawn point in the volume + a variation seed.
  const aSeed = new Float32Array(maxCount * 3);
  const aRand = new Float32Array(maxCount);
  for (let i = 0; i < maxCount; i++) {
    aSeed[i * 3 + 0] = Math.random();
    aSeed[i * 3 + 1] = Math.random();
    aSeed[i * 3 + 2] = Math.random();
    aRand[i] = Math.random();
  }
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 3));
  geometry.setAttribute('aRand', new THREE.InstancedBufferAttribute(aRand, 1));

  const uniforms = {
    uTime: sharedUniforms.uTime,
    uWind: sharedUniforms.uWind,
    uLightning: sharedUniforms.uLightning,
    uCameraPos: { value: new THREE.Vector3() },
    uVolume: { value: new THREE.Vector3(50, 40, 50) },
    uSpeed: { value: 22.0 },
    uLength: { value: 1.4 },
    uWidth: { value: 0.012 },
    uOpacity: { value: 0.5 },
    uColor: { value: new THREE.Color(0xb4b8bf) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3  uWind;
      uniform vec3  uCameraPos;
      uniform vec3  uVolume;
      uniform float uSpeed;
      uniform float uLength;
      uniform float uWidth;

      attribute vec3  aSeed;
      attribute float aRand;

      varying vec2  vUv;
      varying float vRand;

      void main() {
        vUv = uv;
        vRand = aRand;

        vec3 vol = uVolume;
        // Volume tracks the camera, biased upward so drops fall into view.
        vec3 origin = uCameraPos - vec3(vol.x * 0.5, vol.y * 0.85, vol.z * 0.5);

        float speed = uSpeed * (0.75 + 0.5 * aRand);
        vec3 base = aSeed * vol;
        vec3 disp = vec3(uWind.x, -speed, uWind.z) * uTime;

        // Wrap each axis to keep the drop inside the moving volume forever.
        vec3 pos = mod(base + disp - origin, vol) + origin;

        // Orient the streak along its velocity, billboarded toward the camera.
        vec3 vel = normalize(vec3(uWind.x, -speed, uWind.z));
        vec3 toCam = normalize(uCameraPos - pos);
        vec3 side = normalize(cross(vel, toCam));

        float len = uLength * (0.7 + 0.6 * aRand);
        vec3 world = pos + side * (position.x * uWidth) + vel * (position.y * len);

        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform vec3  uColor;
      uniform float uLightning;

      varying vec2  vUv;
      varying float vRand;

      void main() {
        // Soft across the width, fading at both ends of the streak.
        float across = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
        float along  = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
        float alpha = across * along * uOpacity * (0.6 + 0.4 * vRand);

        vec3 col = uColor * (1.0 + uLightning * 2.5);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // it's always around the camera
  geometry.instanceCount = Math.floor(maxCount * 0.4); // default density

  return {
    mesh,
    material,
    uniforms,
    maxCount,
    /** Call every frame so the rain volume follows the camera. */
    update() {
      uniforms.uCameraPos.value.copy(camera.position);
    },
    /** Density as a 0..1 fraction of maxCount. */
    setDensity(fraction) {
      geometry.instanceCount = Math.max(
        1,
        Math.floor(THREE.MathUtils.clamp(fraction, 0, 1) * maxCount)
      );
    },
  };
}
