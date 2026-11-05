# Ultra-Realistic Ocean Renderer — Three.js r185 / WebGL2

A cinematic, physically based ocean renderer. Hybrid wave system (GPU FFT
Tessendorf + multi-layer Gerstner swell), switchable oceanographic spectra,
GGX water BRDF, Jacobian-driven procedural foam, HDR reflections and depth-based
refraction. No terrain, boats, weather or gameplay — just the water, as close to
photoreal as possible.

---

## Running

No build step is required — the app loads Three.js r185 from a CDN via an import
map. You only need to serve the folder over HTTP (ES modules don't load from
`file://`).

```bash
# any static server works, e.g.
npm start                 # -> http://localhost:5173   (uses `serve`)
# or
npx serve .
# or
python -m http.server 5173
```

Then open the served URL. A modern desktop GPU + WebGL2 is required (the FFT
needs float render targets, `EXT_color_buffer_float`).

### Using your own HDRI

Open the **Environment (HDRI)** folder in the GUI → **Load .hdr…** and pick an
equirectangular `.hdr` file. It drives both the water reflections and the sky
dome, so the horizon and the reflected sky always match. **Use Procedural Sky**
reverts to the built-in analytic sky.

---

## Architecture

```
index.html              # import map (three@0.185) + canvas + loader
src/
  main.js               # renderer, camera rig, frame loop, GUI wiring
  config.js             # single source of truth for every parameter
  Ocean/
    OceanRenderer.js    # surface mesh, sun, sky, HDRI lifecycle
    OceanSimulation.js  # FFT + Gerstner orchestration, sea-state rebuilds
    OceanMaterial.js    # the water ShaderMaterial + uniform sync
    FFT.js              # GPU Tessendorf FFT (butterfly, spectrum, normalize)
    Spectra.js          # Phillips / JONSWAP / Pierson-Moskowitz variance
    Gerstner.js         # long directional swell authoring
    Foam.js             # Jacobian foam uniforms + GLSL chunk
  Shaders/
    water.vert.js       # hybrid displacement (FFT cascades + Gerstner)
    water.frag.js       # PBR shading: GGX, Fresnel, Beer-Lambert, SSS, foam
    fftKernels.js       # spectrum-update / butterfly / permutation kernels
    fullscreen.vert.js  # full-screen pass-through
  Utils/
    GPUCompute.js       # float render targets + full-screen pass helper
    GUI.js              # lil-gui panel (Ocean/Water/Foam/Lighting/Color/Perf)
    Sky.js              # background dome matching the reflection sky
```

> Shaders ship as `.js` modules exporting GLSL strings so the project runs with
> **no bundler**. The logical `water.vert` / `water.frag` split requested in the
> brief is preserved as `Shaders/water.vert.js` / `Shaders/water.frag.js`.

---

## The mathematics

### 1. FFT ocean (Tessendorf)

The surface is a sum of sinusoids in the spatial-frequency (wavevector **k**)
domain. Each mode gets a random complex amplitude seeded from a wave **spectrum**:

```
h0(k) = (1/√2)·(ξr + i·ξi)·√(S(k))            ξr, ξi ~ N(0,1)
```

evolved in time with the deep-water dispersion `ω(k) = √(g·|k|)` (quantized to a
loop period for seamless tiling):

```
h(k,t) = h0(k)·e^{+iωt} + conj(h0(−k))·e^{−iωt}
```

An inverse FFT brings it to world space. We also transform the **horizontal
displacement** (choppiness, Tessendorf's λ), the **slopes** (for the normal) and
the **displacement gradients** (for the Jacobian / foam):

```
Dx  = IFFT( −i·(kx/|k|)·h )      ∂Dx/∂x = IFFT( (kx²/|k|)·h )
Dz  = IFFT( −i·(kz/|k|)·h )      ∂Dz/∂z = IFFT( (kz²/|k|)·h )
∂y/∂x = IFFT( i·kx·h )           ∂Dx/∂z = IFFT( (kx·kz/|k|)·h )
```

Eight real fields are packed into **two RGBA textures** using the
*two-reals-per-complex-FFT* identity `IFFT(F + i·G) = f + i·g`, so the whole
solve is two complex 2D inverse FFTs.

The FFT itself is a Cooley–Tukey **radix-2 decimation-in-time** butterfly. A
precomputed *butterfly texture* (`log2 N × N`) holds the twiddle factors and the
read indices (bit-reversed at stage 0); `log2 N` horizontal passes then `log2 N`
vertical passes ping-pong between float targets, and a final pass applies the
`1/N²` inverse normalization and the `(−1)^(x+y)` recentering.

**Energy normalization.** Because Phillips, JONSWAP and Pierson–Moskowitz carry
very different absolute magnitudes, the field is renormalized on the CPU to a
target **significant wave height** `Hs ≈ 0.21·V²/g` (fully-developed sea), scaled
by the *Amplitude* control. This makes wave heights believable and controllable
no matter which spectrum (or constant) is selected.

### 2. Spectra (`S(k)`)

* **Phillips** — `A·exp(−1/(kL)²)/k⁴ · |k̂·ŵ|² · exp(−k²l²)`, `L = V²/g`.
* **Pierson–Moskowitz** — fully-developed `S(ω)=αg²/ω⁵·exp(−1.25(ωp/ω)⁴)`.
* **JONSWAP** — PM × peak-enhancement `γ^r`, with `α`, `ωp` from the fetch.

PM/JONSWAP frequency spectra are mapped to wavenumber via `S(k)=S(ω)·(dω/dk)/k`
and given a `|cos((θ−θw)/2)|^(2s)` directional spread.

### 3. Gerstner swell

Up to six long, directional trochoids add ground swell and break up any residual
FFT tiling at large scales:

```
x += Q·A·D·cos(k·(D·x) − ωt)        y += A·sin(k·(D·x) − ωt)
```

with the analytic normal accumulated per the GPU Gems formulation.

### 4. Tiling removal

One FFT tile is sampled at **three world scales** (cascades) and summed, so a
single 256² solve yields large swells, mid waves and fine ripples with no visible
repeat. The surface mesh is also kept centered under the camera (snapped to a
grid cell), giving a genuinely endless ocean.

### 5. Water shading (`water.frag.js`)

* **Normal** = FFT slopes (3 cascades) ⊕ Gerstner normal ⊕ two animated
  procedural micro-detail layers.
* **Fresnel** — Schlick with physically correct `F0 = ((1−n)/(1+n))²` (n = IOR).
* **Specular** — Cook–Torrance **GGX**: `D·G·F / (4·NoV·NoL)` with Smith
  geometry and the Schlick–GGX approximation.
* **Reflection** — GGX-roughness-blurred environment (HDRI equirect or analytic
  sky), Fresnel-weighted.
* **Refraction** — **Beer–Lambert** depth coloration (surface↔deep) over a
  view-dependent path length, plus a **sub-surface scattering** approximation
  that lights wave crests from behind, plus optional chromatic dispersion.
* **Energy conservation** — reflection/refraction split by Fresnel.
* **Grading** — exposure → ACES tone map → saturation/contrast/brightness →
  sRGB, all in-shader (renderer runs `NoToneMapping`).

### 6. Foam (`Foam.js`)

Generated from the displacement **Jacobian**

```
J = (1 + λ∂Dx/∂x)(1 + λ∂Dz/∂z) − (λ∂Dx/∂z)²
```

`J` below the threshold marks compressing/folding crests. The mask is modulated
by animated fbm noise, a curvature-based crest term and a persistence term — no
painted foam.

---

## GUI map

`Ocean` (Wind, Waves, Choppiness, Swell, FFT) · `Water` (Reflection, Refraction,
Fresnel, Roughness/Specular) · `Foam` · `Lighting` (Sun, Intensity, Color) ·
`Color` (tints, absorption, scattering, grading) · `Performance` (mesh / FFT
resolution, quality presets) · `Environment` (HDRI).

## License

MIT
