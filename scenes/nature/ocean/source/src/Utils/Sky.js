/**
 * Sky.js
 * -----------------------------------------------------------------------------
 * Large background dome whose gradient + sun disk match the procedural sky used
 * inside the water reflections, so the horizon is seamless. When an HDRI is
 * loaded it is used as an equirect background instead and this dome is hidden.
 * -----------------------------------------------------------------------------
 */

import * as THREE from 'three';

const SKY_VERT = /* glsl */ `
out vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // force to far plane
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
#define PI 3.141592653589793
in vec3 vDir;
out vec4 fragColor;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uHorizonColor;
uniform vec3 uDeepColor;
uniform float uExposure;
uniform float uHasEnv;
uniform float uEnvIntensity;
uniform float uTime;
uniform float uCloudiness;
uniform vec3  uFogColor;
uniform float uFogAmount;
uniform sampler2D uEnvMap;

vec3 aces(vec3 x){
  const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
}
vec2 equirectUv(vec3 d){
  return vec2(atan(d.z, d.x)/(2.0*PI)+0.5, asin(clamp(d.y,-1.0,1.0))/PI+0.5);
}

// ── value-noise fbm for clouds ──────────────────────────────────────────────
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}
float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){v+=a*noise(p);p*=2.03;a*=0.5;} return v; }

// Puffy cumulus clouds projected onto a sky plane, drifting with the wind.
float clouds(vec3 dir){
  if (dir.y <= 0.015) return 0.0;
  vec2 uv = dir.xz / dir.y;           // gnomonic projection onto a high plane
  uv = uv * 0.45 + uTime * 0.006;
  float base = fbm(uv);
  float detail = fbm(uv * 3.1 - uTime * 0.01);
  float d = base * 0.7 + detail * 0.3;
  float cover = mix(0.62, 0.34, clamp(uCloudiness, 0.0, 1.0)); // lower = more cloud
  float c = smoothstep(cover, cover + 0.22, d);
  return c * smoothstep(0.0, 0.32, dir.y);   // fade into the horizon haze
}

vec3 skyGradient(vec3 dir){
  float up = clamp(dir.y, -1.0, 1.0);
  vec3 zenith  = vec3(0.07, 0.30, 0.66);
  vec3 horizon = uHorizonColor;
  vec3 ground  = mix(uHorizonColor, uDeepColor, 0.65);
  return up >= 0.0 ? mix(horizon, zenith, pow(up, 0.48))
                   : mix(horizon, ground, clamp(-up * 3.5, 0.0, 1.0));
}

void main(){
  vec3 dir = normalize(vDir);
  vec3 col;
  if (uHasEnv > 0.5){
    col = texture(uEnvMap, equirectUv(dir)).rgb * uEnvIntensity;
    float sd = max(dot(dir, normalize(uSunDirection)), 0.0);
    col += uSunColor * uSunIntensity * smoothstep(0.9995, 0.99986, sd) * 6.0;
  } else {
    col = skyGradient(dir);
    // Clouds, lit toward the sun.
    float cl = clouds(dir);
    float sun = max(dot(dir, normalize(uSunDirection)), 0.0);
    vec3 cloudLit = mix(vec3(0.72, 0.78, 0.86), vec3(1.05, 1.02, 0.97), 0.6 + 0.4 * sun);
    col = mix(col, cloudLit, cl * 0.9);

    float sd = sun;
    float disk = smoothstep(0.9995, 0.99986, sd);
    float glow = pow(sd, 220.0) * 0.5 + pow(sd, 16.0) * 0.18;
    col += uSunColor * uSunIntensity * (disk * 8.0 + glow) * (1.0 - cl * 0.7);

    // Blueish atmospheric fog band hugging the horizon (matches the water fog).
    float horizonFog = pow(1.0 - clamp(abs(dir.y), 0.0, 1.0), 6.0);
    col = mix(col, uFogColor, horizonFog * uFogAmount);
  }

  col *= uExposure;
  col = aces(col);
  col = pow(col, vec3(1.0/2.2));
  fragColor = vec4(col, 1.0);
}
`;

export class Sky {
  constructor(config) {
    this.config = config;
    const geo = new THREE.SphereGeometry(1, 48, 32);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor:     { value: new THREE.Color(config.lighting.sunColor).convertSRGBToLinear() },
        uSunIntensity: { value: config.lighting.sunIntensity },
        uHorizonColor: { value: new THREE.Color(config.color.horizonColor).convertSRGBToLinear() },
        uDeepColor:    { value: new THREE.Color(config.color.deepColor).convertSRGBToLinear() },
        uExposure:     { value: config.color.exposure },
        uHasEnv:       { value: 0 },
        uEnvIntensity: { value: config.lighting.envIntensity },
        uEnvMap:       { value: null },
        uTime:         { value: 0 },
        uCloudiness:   { value: 0.5 },
        uFogColor:     { value: new THREE.Color(config.fog.color).convertSRGBToLinear() },
        uFogAmount:    { value: config.fog.skyAmount },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.setScalar(8000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  setSun(dir) { this.material.uniforms.uSunDirection.value.copy(dir); }

  setTime(t) { this.material.uniforms.uTime.value = t; }

  setEnvMap(tex) {
    this.material.uniforms.uEnvMap.value = tex;
    this.material.uniforms.uHasEnv.value = tex ? 1 : 0;
  }

  sync() {
    const u = this.material.uniforms;
    u.uSunColor.value.copy(new THREE.Color(this.config.lighting.sunColor).convertSRGBToLinear());
    u.uSunIntensity.value = this.config.lighting.sunIntensity;
    u.uHorizonColor.value.copy(new THREE.Color(this.config.color.horizonColor).convertSRGBToLinear());
    u.uDeepColor.value.copy(new THREE.Color(this.config.color.deepColor).convertSRGBToLinear());
    u.uExposure.value = this.config.color.exposure;
    u.uEnvIntensity.value = this.config.lighting.envIntensity;
    u.uCloudiness.value = this.config.lighting.cloudiness;
    u.uFogColor.value.copy(new THREE.Color(this.config.fog.color).convertSRGBToLinear());
    u.uFogAmount.value = this.config.fog.skyAmount;
  }

  setVisible(v) { this.mesh.visible = v; }
}
