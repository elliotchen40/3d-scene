# 3D Scene

Three.js 场景合集 —— 纯静态部署，无外部 CDN 依赖。

| 场景 | 说明 | 技术栈 |
| --- | --- | --- |
| [Sidi Bou Said](scenes/sidi-bou-said/) | 突尼斯悬崖蓝白村庄，程序化生成，巷道拾级而上抵达俯瞰突尼斯湾的崖顶平台 | Three.js 0.160 · GLSL · 单文件 HTML |
| [Forest](scenes/forest/) | 第一人称林地漫游，流动溪流、步态与涉水音效 | Three.js 0.153 · 原生 ES modules |
| [Veilspire](scenes/veilspire/) | 开放世界魔法学院谷地：城堡、村庄、遗迹、洞窟、湖泊、昼夜天气与居民（已移除全部战斗与任务） | Three.js 0.185 · Vite |
| [自然环境素材库](scenes/nature/) | 九个自然环境方向的开源项目：四季昼夜、12 群系漂浮岛、Gerstner 海面、FFT 物理海、土壤苔藓草、飘雪积雪、雨丝涟漪闪电、表面生成藤蔓、零素材丛林小径 | Three.js 0.170–0.186 · Vite |

## 本地预览

```sh
node server.mjs            # → http://localhost:8002
PORT=9000 node server.mjs  # 换端口
```

任意静态托管均可直接部署（GitHub Pages / Netlify / nginx）。仓库根目录的 `index.html` 是场景索引页。

## 目录结构

```
index.html              场景索引页
server.mjs              本地静态服务器
favicon.svg
scenes/
  sidi-bou-said/        单文件场景（importmap 指向 vendor）
  forest/               源码 + public 资源（importmap 指向 vendor）
  veilspire/            Vite 构建产物（部署用）
    assets/             打包后的 JS
    source/             源码，可重新构建
  nature/               自然环境素材库（九个项目）
    index.html          素材库索引页
    build-nature.mjs    批量重新构建脚本
    <slug>/             每个项目的构建产物（部署用）
      source/           源码，可重新构建
vendor/
  three-0.153/          build/ + 所需 addons + draco 解码器
  three-0.160/          build/ + OrbitControls
  three-0.170/          build/（jungle-trail 用）
```

`vendor/` 里只保留各场景实际用到的 addon 子集，避免把整个 `examples/jsm`（15MB）塞进仓库。

## 场景 URL 参数

**Sidi Bou Said** 支持 URL hash 定位视角：

- `#overview` —— 鸟瞰全村
- `#t=0.35` —— 巷道 35% 处（`t` 取 0–1）
- `#yaw=0.3` / `#pitch=-0.04` —— 覆盖初始朝向

游戏内按 `V` 键在「行走 / 鸟瞰」之间切换。

## 更新 Veilspire

`scenes/veilspire/` 是构建产物，源码在 `scenes/veilspire/source/`（已移除全部战斗与任务）。

```sh
cd scenes/veilspire/source
npm install
npm run build
cp -r dist/* ../
```

想恢复完整 RPG 版，从上游仓库重新构建：https://github.com/Lunaneco/veilspire

> Veilspire 的 `index.html` 带 `Content-Security-Policy: script-src 'self'`，禁止内联脚本，所以它无法像另外两个场景那样直接注入 importmap —— 必须走 Vite 构建把 import 打包进产物。

## 更新自然环境素材库

`scenes/nature/<slug>/` 是构建产物，源码在 `scenes/nature/<slug>/source/`。

```sh
cd scenes/nature
node build-nature.mjs              # 全部重建
node build-nature.mjs small-world  # 只重建某一个
```

脚本做三件事：

1. **根绝对路径 → 相对路径** —— 上游项目大量用 `/map/...` `/Material_1/...` 这类根绝对路径，
   在 GitHub Pages 的 `/<repo>/` 子路径下会 404，而且 `<base href>` 对根绝对路径**无效**
   （实测 `/map/day/px.png` 仍解析到站点根）。改成 `./map/...` 后任何挂载前缀下都能解析。
2. **vite `base: './'`** —— 让产物里的 `/assets/xxx.js` 变成 `./assets/xxx.js`。
3. **构建产物提到 `<slug>/` 根**，`source/` 只留源码。

> 九个项目已验证在 `/<repo>/` 子路径下正常渲染、零 404。

## 三方来源与许可

- **Sidi Bou Said** —— 来自 [pulkitxm/claude-directory](https://github.com/pulkitxm/claude-directory/tree/main/3d-games/sidi-bou-said-3d-walk)
- **Veilspire** —— 来自 [Lunaneco/veilspire](https://github.com/Lunaneco/veilspire)
- **Forest** —— 来自 [jolilhayder/3d-forest-environment](https://github.com/jolilhayder/3d-forest-environment)
- **自然环境素材库** —— 九个项目全部 MIT，各自带原始 `LICENSE`：
  - [SahilK-027/Elemental-Serenity](https://github.com/SahilK-027/Elemental-Serenity)
  - [paulrobello/small-world](https://github.com/paulrobello/small-world)
  - [achrefelouafi/WaterThreeJS](https://github.com/achrefelouafi/WaterThreeJS)
  - [achrefelouafi/OceanThreejs](https://github.com/achrefelouafi/OceanThreejs)
  - [achrefelouafi/GrassSystemThreeJS](https://github.com/achrefelouafi/GrassSystemThreeJS)
  - [achrefelouafi/SnowSystemThreeJS](https://github.com/achrefelouafi/SnowSystemThreeJS)
  - [achrefelouafi/RainSystemThreeJS](https://github.com/achrefelouafi/RainSystemThreeJS)
  - [achrefelouafi/VegetationGeneratorThreeJS](https://github.com/achrefelouafi/VegetationGeneratorThreeJS)
  - [StarKnightt/jungle-trail](https://github.com/StarKnightt/jungle-trail)
- **Three.js** —— MIT，见 `vendor/three-*/LICENSE`

各场景版权归原作者，本仓库仅作收集与统一部署。
