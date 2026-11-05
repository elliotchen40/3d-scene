/**
 * SandFloor.js
 * -----------------------------------------------------------------------------
 * A large sandy sea-bed plane below the water surface, shaded with a real PBR
 * texture set (public/Ground098_1K-JPG_*: Color, NormalDX, Roughness, AO) plus
 * animated caustics. It is never seen directly — the water plane always covers
 * the view — but is captured into the refraction render target and sampled by
 * the water shader, so seeing the lit sand through depth-absorbing water gives
 * the tropical turquoise→deep-blue gradient and the dancing caustic light.
 *
 * The footprint matches the ocean's (so it shares the water's hazed horizon and
 * never pokes out as a beach), and it outputs LINEAR colour — the water shader
 * does the single grading pass after mixing it with the water body colour.
 * -----------------------------------------------------------------------------
 */

import * as THREE from 'three';

// Vite serves /public at BASE_URL (default '/'); fall back to '/' elsewhere.
const TEX_BASE = (import.meta && import.meta.env && import.meta.env.BASE_URL) || '/';
const TEX = {
  color:     'Ground098_1K-JPG_Color.jpg',
  normal:    'Ground098_1K-JPG_NormalDX.jpg',
  roughness: 'Ground098_1K-JPG_Roughness.jpg',
  ao:        'Ground098_1K-JPG_AmbientOcclusion.jpg',
};

const SAND_VERT = /* glsl */ `
out vec2 vWorldXZ;
void main(){
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldXZ = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SAND_FRAG = /* glsl */ `
precision highp float;
out vec4 fragColor;
in vec2 vWorldXZ;

uniform sampler2D uColorMap;
uniform sampler2D uNormalMap;
uniform sampler2D uRoughMap;
uniform sampler2D uAoMap;
uniform float uTextureScale;
uniform float uNormalStrength;
uniform float uBrightness;

uniform float uTime;
uniform float uCausticIntensity;
uniform float uCausticScale;
uniform float uCausticSpeed;
uniform vec3  uSunColor;
uniform vec3  uSunDirection;

// Classic iterative caustic field (folded sinusoids) — dancing light on the bed.
float caustic(vec2 uv, float time){
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 5; n++){
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten),
                           p.y / (cos(i.y + t) / inten)));
  }
  c /= 5.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}

void main(){
  vec2 uv = vWorldXZ * uTextureScale;

  // Albedo (sRGB → linear; this is a raw GLSL3 material so we convert by hand).
  vec3 albedo = pow(texture(uColorMap, uv).rgb, vec3(2.2));
  float ao   = texture(uAoMap, uv).r;
  float rough = texture(uRoughMap, uv).r;

  // Tangent-space normal (NormalDX → flip green for OpenGL convention). The bed
  // is flat in XZ, so tangent=+X, bitangent=+Z, up=+Y.
  vec3 nm = texture(uNormalMap, uv).rgb * 2.0 - 1.0;
  nm.y = -nm.y;
  nm.xy *= uNormalStrength;
  vec3 N = normalize(vec3(nm.x, nm.z, nm.y));

  // Soft directional (sun) lighting + skylight fill, modulated by AO.
  vec3 L = normalize(uSunDirection);
  float ndl = clamp(dot(N, L), 0.0, 1.0);
  float wrap = ndl * 0.65 + 0.35;
  vec3 lit = albedo * ao * uSunColor * wrap + albedo * 0.15;
  // Tiny rough specular glint off wet sand.
  float spec = pow(ndl, mix(40.0, 6.0, rough)) * (1.0 - rough) * 0.15;
  lit += uSunColor * spec;
  lit *= uBrightness;

  // Caustics: two layers at different scales/speeds, stronger in lit areas.
  vec2 cp = vWorldXZ * uCausticScale;
  float c = caustic(cp, uTime * uCausticSpeed);
  c += caustic(cp * 1.7 + 13.0, uTime * uCausticSpeed * 0.8) * 0.6;
  lit += uSunColor * c * uCausticIntensity * (0.5 + 0.5 * ndl);

  fragColor = vec4(lit, 1.0); // LINEAR — water shader grades later
}
`;

export class SandFloor {
  constructor(config, renderer) {
    this.config = config;
    const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;

    const loader = new THREE.TextureLoader();
    const load = (file, srgb) => {
      const t = loader.load(TEX_BASE + file);
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = maxAniso;
      return t;
    };

    const colorMap = load(TEX.color, true);
    const normalMap = load(TEX.normal, false);
    const roughMap = load(TEX.roughness, false);
    const aoMap = load(TEX.ao, false);

    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    geo.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uColorMap:         { value: colorMap },
        uNormalMap:        { value: normalMap },
        uRoughMap:         { value: roughMap },
        uAoMap:            { value: aoMap },
        uTextureScale:     { value: config.sand.textureScale },
        uNormalStrength:   { value: config.sand.normalStrength },
        uBrightness:       { value: config.sand.brightness },
        uTime:             { value: 0 },
        uCausticIntensity: { value: config.sand.causticIntensity },
        uCausticScale:     { value: config.sand.causticScale },
        uCausticSpeed:     { value: config.sand.causticSpeed },
        uSunColor:         { value: new THREE.Color(config.lighting.sunColor).convertSRGBToLinear() },
        uSunDirection:     { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: SAND_VERT,
      fragmentShader: SAND_FRAG,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this._resize();
  }

  _resize() {
    // Match the ocean's footprint (slightly smaller) so the sand never pokes out
    // past the water edge — its far edge sits under the water's hazed horizon.
    const s = this.config.ocean.oceanSize * 0.98;
    this.mesh.scale.set(s, 1, s);
  }

  get level() { return -this.config.sand.depth; }

  update(time, camera, sunDir) {
    const u = this.material.uniforms;
    u.uTime.value = time;
    if (sunDir) u.uSunDirection.value.copy(sunDir);
    this.mesh.position.y = this.level;
    this._resize();
    if (camera) {
      this.mesh.position.x = camera.position.x;
      this.mesh.position.z = camera.position.z;
    }
  }

  sync() {
    const u = this.material.uniforms;
    u.uTextureScale.value = this.config.sand.textureScale;
    u.uNormalStrength.value = this.config.sand.normalStrength;
    u.uBrightness.value = this.config.sand.brightness;
    u.uCausticIntensity.value = this.config.sand.causticIntensity;
    u.uCausticScale.value = this.config.sand.causticScale;
    u.uCausticSpeed.value = this.config.sand.causticSpeed;
    u.uSunColor.value.copy(new THREE.Color(this.config.lighting.sunColor).convertSRGBToLinear());
    this._resize();
  }
}
