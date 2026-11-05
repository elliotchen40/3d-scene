import * as THREE from 'three';

/**
 * A single small "comic" puff cloud, raymarched (WebGL/GLSL).
 *
 * The shape is a cluster of blobs joined with a smooth-union SDF and a flat
 * bottom — the classic cartoon rain cloud. FBM noise roughens the surface into
 * fluff, a short sun-march gives soft self-shadowing, and it's all sampled in
 * the mesh's local space so move / rotate / scale transforms it for free.
 *
 * Exposes seed / position / rotation / size / puffiness / density controls.
 */
export function createClouds({ scene, camera, sharedUniforms, sun }) {
  const uniforms = {
    uModelInv: { value: new THREE.Matrix4() },
    uCameraPos: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3) }, // world space
    uTime: sharedUniforms.uTime,
    uWind: sharedUniforms.uWind,
    uLightning: sharedUniforms.uLightning,

    uSeed: { value: new THREE.Vector3(-50, 4.7, -50) },
    uPuff: { value: 3.0 }, // fluffiness of the edges
    uDensity: { value: 3.0 }, // opacity / thickness
    uDetail: { value: 12.0 }, // noise frequency
    uSteps: { value: 40 }, // raymarch quality
    uLightSteps: { value: 5 },

    uColor: { value: new THREE.Color(0xffffff) }, // cloud albedo
    uSunColor: { value: new THREE.Color(0xfff0d8) },
    uSunIntensity: { value: 6.0 },
    uAmbient: { value: new THREE.Color(0x5a6878) }, // brighter so undersides read soft, not black
    uAbsorption: { value: 2.0 },
    uSunAbsorption: { value: 2.2 },
    uAnisotropy: { value: 0.5 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide, // march from the far face inward
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vWorldPos;

      uniform mat4  uModelInv;
      uniform vec3  uCameraPos;
      uniform vec3  uSunDir;
      uniform float uTime;
      uniform vec3  uWind;
      uniform float uLightning;

      uniform vec3  uSeed;
      uniform float uPuff;
      uniform float uDensity;
      uniform float uDetail;
      uniform float uSteps;
      uniform float uLightSteps;

      uniform vec3  uColor;
      uniform vec3  uSunColor;
      uniform float uSunIntensity;
      uniform vec3  uAmbient;
      uniform float uAbsorption;
      uniform float uSunAbsorption;
      uniform float uAnisotropy;

      const int MAX_STEPS = 96;
      const int MAX_LIGHT = 8;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float vnoise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) {
        float v = 0.0, a = 0.5;
        mat3 m = mat3(0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);
        for (int i = 0; i < 5; i++) {
          v += a * vnoise(p);
          p = m * p * 2.02;
          a *= 0.5;
        }
        return v;
      }

      float sdSphere(vec3 p, vec3 c, float r) { return length(p - c) - r; }
      float smin(float a, float b, float k) {
        float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
        return mix(b, a, h) - k * h * (1.0 - h);
      }

      // Per-lobe jitter driven by the seed, so Randomize changes the silhouette.
      vec3 lobePos(vec3 base, float idx) {
        vec3 h = vec3(hash(uSeed * 0.137 + idx),
                      hash(uSeed * 0.137 + idx + 5.0),
                      hash(uSeed * 0.137 + idx + 11.0));
        return base + (h - 0.5) * 0.16;
      }
      float lobeR(float r, float idx) {
        return r * (0.75 + 0.6 * hash(uSeed * 0.137 + idx + 31.0));
      }

      // Cartoon cloud silhouette: a cluster of lobes with a flat bottom.
      float cloudSDF(vec3 p) {
        float d = sdSphere(p, lobePos(vec3(-0.24, -0.02, 0.0), 1.0), lobeR(0.18, 1.0));
        d = smin(d, sdSphere(p, lobePos(vec3(-0.02, 0.06, 0.02), 2.0), lobeR(0.24, 2.0)), 0.12);
        d = smin(d, sdSphere(p, lobePos(vec3( 0.20, 0.0, -0.03), 3.0), lobeR(0.20, 3.0)), 0.12);
        d = smin(d, sdSphere(p, lobePos(vec3( 0.08, -0.05, 0.10), 4.0), lobeR(0.16, 4.0)), 0.12);
        d = smin(d, sdSphere(p, lobePos(vec3(-0.13, -0.04, -0.08), 5.0), lobeR(0.15, 5.0)), 0.12);
        d = smin(d, sdSphere(p, lobePos(vec3( 0.30, -0.04, 0.0), 6.0), lobeR(0.12, 6.0)), 0.10);
        // Flatten the underside (intersect with the half-space y >= -0.16).
        d = max(d, -0.16 - p.y);
        return d;
      }

      // Density at a local-space point (unit box is [-0.5, 0.5]).
      float densityAt(vec3 lp) {
        // Shape lives in a slightly shrunk frame so it never touches the walls.
        vec3 cp = lp * 1.3;
        vec3 drift = vec3(uWind.x, 0.0, uWind.z) * uTime * 0.01;
        float n = fbm((cp + uSeed) * uDetail + drift);
        float d = cloudSDF(cp) - n * 0.07 * uPuff; // roughen the surface into fluff
        float dens = smoothstep(0.03, -0.04, d) * uDensity;
        // Fade to zero before the box walls so nothing gets a hard crop.
        vec3 e = 0.5 - abs(lp);
        float edge = smoothstep(0.0, 0.1, min(min(e.x, e.y), e.z));
        return dens * edge;
      }

      // March toward the sun for self-shadowing.
      float lightMarch(vec3 p, vec3 sunLocal) {
        float stepL = 0.09;
        float dens = 0.0;
        for (int i = 0; i < MAX_LIGHT; i++) {
          if (float(i) >= uLightSteps) break;
          vec3 sp = p + sunLocal * stepL * (float(i) + 0.5);
          dens += densityAt(sp) * stepL;
        }
        return exp(-dens * uSunAbsorption);
      }

      vec2 intersectBox(vec3 ro, vec3 rd) {
        vec3 inv = 1.0 / rd;
        vec3 t0 = (vec3(-0.5) - ro) * inv;
        vec3 t1 = (vec3(0.5) - ro) * inv;
        vec3 tmin = min(t0, t1);
        vec3 tmax = max(t0, t1);
        return vec2(max(max(tmin.x, tmin.y), tmin.z),
                    min(min(tmax.x, tmax.y), tmax.z));
      }

      float HG(float c, float g) {
        float g2 = g * g;
        return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5));
      }

      void main() {
        vec3 ro = (uModelInv * vec4(uCameraPos, 1.0)).xyz;
        vec3 rd = normalize((uModelInv * vec4(vWorldPos, 1.0)).xyz - ro);
        vec3 sunLocal = normalize((uModelInv * vec4(uSunDir, 0.0)).xyz);

        vec2 hit = intersectBox(ro, rd);
        float tN = max(hit.x, 0.0);
        float tF = hit.y;
        if (tF <= tN) discard;

        float span = tF - tN;
        float stepSize = span / uSteps;
        float dither = hash(vec3(gl_FragCoord.xy, uTime)) * stepSize;
        float t = tN + dither;

        float phase = mix(HG(dot(rd, sunLocal), uAnisotropy), 0.25, 0.5);
        vec3 sunCol = uSunColor * uSunIntensity + vec3(uLightning * 3.0);

        vec3 col = vec3(0.0);
        float transmittance = 1.0;

        for (int i = 0; i < MAX_STEPS; i++) {
          if (float(i) >= uSteps || t > tF) break;
          vec3 p = ro + rd * t;
          float d = densityAt(p);
          if (d > 0.001) {
            float dens = d * stepSize;
            float light = lightMarch(p, sunLocal);
            vec3 lit = sunCol * light * phase + uAmbient;
            col += transmittance * dens * lit * uColor;
            transmittance *= exp(-dens * uAbsorption);
            if (transmittance < 0.01) break;
          }
          t += stepSize;
        }

        float alpha = 1.0 - transmittance;
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.scale.set(14, 9, 11); // small, comic-sized puff
  mesh.position.set(0, 15, 0); // hovering low over the scene
  mesh.frustumCulled = false;
  mesh.visible = false; // off until enabled
  scene.add(mesh);

  const _sun = new THREE.Vector3();

  return {
    mesh,
    uniforms,
    setVisible(v) {
      mesh.visible = v;
    },
    update() {
      if (!mesh.visible) return;
      mesh.updateMatrixWorld();
      uniforms.uModelInv.value.copy(mesh.matrixWorld).invert();
      uniforms.uCameraPos.value.copy(camera.position);
      if (sun) uniforms.uSunDir.value.copy(_sun.copy(sun.position).normalize());
    },
  };
}
