# 深海回声 · Abyssal Echo

建在 [Abyssal Garden](../abyssal-garden/) 引擎上的找东西游戏。海沟里随机散落着 12 枚**光核**，水太浑，肉眼看不见它们 —— 只能靠声呐定位。

## 玩法

| | |
| --- | --- |
| 光核 | 每局随机生成 12 枚，放在海床附近的开阔水域，深度 12–42 米 |
| 分值 | `50 + 深度 × 6`，越深越值钱（约 120–300 分一枚） |
| 氧气 | **只减不增**。浅水 0.25%/秒，12 米以下 0.35%/秒起算并随深度递增（42 米处约 1.8%/秒），冲刺再 ×1.5 |
| 失败 | 氧气归零 → 这次下潜结束，结算已捞到的光核 |
| 通关 | 找齐 12 枚 → 结算总分与用时，成绩存 localStorage |
| 声呐 | 2 秒冷却，定位 45 米内的光核并给出罗盘方位与距离 |

未被声呐定位的光核只有极暗的微光（亮度 0.045），只是让浑水里「好像有点什么」，定位后才真正发光（亮度 0.3–1.2，恒亮不吃雾）。

## 操作

| 设备 | 操作 |
| --- | --- |
| 桌面 | 空格 = 声呐，鼠标锁定转向，WASD/按住前进，Shift 加速 |
| 手机 | 右下角圆形声呐按钮，按住前进 · 滑动转向 · 第二指加速 |

## 构建

引擎源码不在本目录，与 `abyssal-garden` 共用同一份（`../abyssal-garden/source/src/`）。构建脚本往 `main.js` 里注入两个钩子，再把 `src/game.js` 接在后面：

- `if (GAME) GAME.tick();` —— 紧邻唯一的 `render();` 之前，逐帧推进游戏逻辑
- `if (GAME) GAME.draw(r);` —— 在场景渲染通道里、`r.end();` 之前，把光核画进 HDR 目标（参与深度测试与 bloom）

两个锚点都做了唯一性断言：上游改动导致锚点失效时构建直接报错，而不是静默出错。

```sh
npm install --include=dev   # esbuild
npm run build               # → ../index.html（单文件，约 110 kB / gzip 45 kB）
npm run build:readable      # 同样产物，但不压缩，便于调试
```

> 本机 `NODE_ENV=production`，`npm install` 会跳过 devDependencies，必须带 `--include=dev`。

## 调试

`?debug=1` 会额外挂出 `__gS`（游戏状态）、`__aeLook`（传送）、`__aeOpen`（是否在开阔水域）、`__aeRock` / `__aeFloor`（距离场查询）、`__aePick`（光核管线与缓冲）。

## 许可

MIT。引擎部分版权属于 Maksymilian Dendura，详见 `LICENSE`。
