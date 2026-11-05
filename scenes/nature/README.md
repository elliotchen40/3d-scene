# 自然环境素材库

九个自然环境方向的 Three.js 开源项目，全部 MIT 许可，收集用于统一部署与学习参考。

## 项目清单

| slug | 项目 | 说明 | 技术栈 |
| --- | --- | --- | --- |
| `elemental-serenity` | [Elemental Serenity](https://github.com/SahilK-027/Elemental-Serenity) | 自然微缩景观：四季切换（春/秋/冬/雨）+ 昼夜循环，篝火、帐篷、拱桥、池塘。Managers 架构 | Three.js 0.182 · GSAP · Vite |
| `small-world` | [small-world](https://github.com/paulrobello/small-world) | 程序化漂浮岛生态箱：12 个生物群系，地形/植物/生物/鸟/天气/昼夜，16 位种子生成 | Three.js 0.186 · Vite |
| `water` | [WaterThreeJS](https://github.com/achrefelouafi/WaterThreeJS) | Gerstner 海面 + SSR 反射 + 浪沫 + 体积云 + 水下，2869 行，体量最小最好移植 | Three.js 0.185 · Vite |
| `ocean` | [OceanThreejs](https://github.com/achrefelouafi/OceanThreejs) | FFT 物理海：JONSWAP 谱、级联 FFT + 6 路 Gerstner，风速/浪高/泡沫可调 | Three.js 0.185 · GLSL3 · Vite |
| `grass` | [GrassSystemThreeJS](https://github.com/achrefelouafi/GrassSystemThreeJS) | 实时程序化土壤沙盒：拖拽雕刻、Worley 干裂、苔藓覆盖、GPU instanced 随风草 | Three.js 0.185 · Vite |
| `snow` | [SnowSystemThreeJS](https://github.com/achrefelouafi/SnowSystemThreeJS) | 飘雪 + 积雪着色器（world-space FBM mask 抬升 albedo、冰晶闪烁） | Three.js 0.185 · Vite |
| `rain` | [RainSystemThreeJS](https://github.com/achrefelouafi/RainSystemThreeJS) | 雨丝、地面涟漪、水洼、闪电 | Three.js 0.185 · Vite |
| `vegetation` | [VegetationGeneratorThreeJS](https://github.com/achrefelouafi/VegetationGeneratorThreeJS) | 在任意模型表面绘制并生成生长的藤蔓与花（BVH surface painter） | Three.js 0.185 · WebGPU · Vite |
| `jungle-trail` | [jungle-trail](https://github.com/StarKnightt/jungle-trail) | 第一人称丛林小径，地形/植被/水/雾全程序化，零外部美术资源 | Three.js 0.170 · 原生 ES modules |

## 目录结构

每个项目：

```
<slug>/
  index.html          构建产物（部署用）
  assets/             打包后的 JS
  <素材>/              PBR 贴图 / glb 模型 / 音频
  source/             源码，可重新构建
    package.json
    src/  public/
```

`build-nature.mjs` 是批量构建脚本。

## 重新构建

```sh
node build-nature.mjs              # 全部重建
node build-nature.mjs small-world  # 只重建某一个
```

脚本做三件事：

1. **根绝对路径 → 相对路径** —— 上游项目大量用 `/map/...` `/Material_1/...` 这类根绝对路径，
   在 GitHub Pages 的 `/<repo>/` 子路径下会 404。而且 `<base href>` 对根绝对路径**无效**
   （实测 `/map/day/px.png` 仍解析到站点根，只有相对路径才按 base 解析）。
   改成 `./map/...` 后任何挂载前缀下都能解析。
2. **vite `base: './'`** —— 让产物里的 `/assets/xxx.js` 变成 `./assets/xxx.js`。
3. **构建产物提到 `<slug>/` 根**，`source/` 只留源码。

> `jungle-trail` 没有 vite 配置，是纯 ES module 脚本；它的 three 依赖走仓库共享的
> `vendor/three-0.170/`（importmap 指向 `../../../vendor/three-0.170/build/three.module.js`）。

## 已验证

九个项目在 `/<repo>/` 子路径下（模拟 GitHub Pages）逐个截图验证：**正常渲染、零 JS 错误、零 404**。

## 移植到 ourworld 的注意事项

ourworld 的 three 是 **r147**（`frontend/vendor/three-147.min.js`）和 r168 module。
r147 **没有** `outputColorSpace`，输出编码 chunk 名是 `encodings_fragment`
（r185 是 `colorspace_fragment`）—— **直接抄这些项目的 shader 会挂**，
要么先升 three 版本，要么把 shader 降级重写。

ourworld 的 3D 场景是全程序化零外部素材、手绘低多边形风（#E8B14A / #7FB8D4 / #8FAE5A / #A87648），
**写实 PBR 贴图直接换上会风格冲突**。建议抄 shader 和算法（FFT/Gerstner 海面、雪堆积、
雨涟漪、instanced 草、季节管理器），不引外部模型文件。

另外 ourworld 的 V23 manifest 与三端缓存白名单**不含 glb/gltf/hdr**，
要走增量同步得先在服务端 `_MANIFEST_EXTS` 与 Android/鸿蒙 `V23AssetCache.CACHEABLE_EXT` 加白名单。
