# 3D Scene

Three.js 场景合集 —— 纯静态部署，无外部 CDN 依赖。

| 场景 | 说明 | 技术栈 |
| --- | --- | --- |
| [Sidi Bou Said](scenes/sidi-bou-said/) | 突尼斯悬崖蓝白村庄，程序化生成，巷道拾级而上抵达俯瞰突尼斯湾的崖顶平台 | Three.js 0.160 · GLSL · 单文件 HTML |
| [Forest](scenes/forest/) | 第一人称林地漫游，流动溪流、步态与涉水音效 | Three.js 0.153 · 原生 ES modules |
| [Veilspire](scenes/veilspire/) | 原创开放世界魔法动作 RPG：地形、聚落、城堡、洞窟、植被、天气，配战斗与任务系统 | Three.js 0.185 · Vite |

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
  veilspire/            Vite 构建产物（dist）
vendor/
  three-0.153/          build/ + 所需 addons + draco 解码器
  three-0.160/          build/ + OrbitControls
```

`vendor/` 里只保留各场景实际用到的 addon 子集，避免把整个 `examples/jsm`（15MB）塞进仓库。

## 场景 URL 参数

**Sidi Bou Said** 支持 URL hash 定位视角：

- `#overview` —— 鸟瞰全村
- `#t=0.35` —— 巷道 35% 处（`t` 取 0–1）
- `#yaw=0.3` / `#pitch=-0.04` —— 覆盖初始朝向

游戏内按 `V` 键在「行走 / 鸟瞰」之间切换。

## 更新 Veilspire

`scenes/veilspire/` 是构建产物，源码在上游仓库。要更新：

```sh
git clone https://github.com/Lunaneco/veilspire
cd veilspire
npm install
npm run build
cp -r dist/* ../3d-scene/scenes/veilspire/
```

> Veilspire 的 `index.html` 带 `Content-Security-Policy: script-src 'self'`，禁止内联脚本，所以它无法像另外两个场景那样直接注入 importmap —— 必须走 Vite 构建把 import 打包进产物。

## 三方来源与许可

- **Sidi Bou Said** —— 来自 [pulkitxm/claude-directory](https://github.com/pulkitxm/claude-directory/tree/main/3d-games/sidi-bou-said-3d-walk)
- **Veilspire** —— 来自 [Lunaneco/veilspire](https://github.com/Lunaneco/veilspire)
- **Forest** —— 来自 [jolilhayder/3d-forest-environment](https://github.com/jolilhayder/3d-forest-environment)
- **Three.js** —— MIT，见 `vendor/three-*/LICENSE`

各场景版权归原作者，本仓库仅作收集与统一部署。
