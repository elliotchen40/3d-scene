# Abyssal Garden — 程序化水下世界（WebGPU）

**A dreamy underwater world you can swim through, right in your browser.**

高耸的海带森林、从波动的海面倾泻而下的光柱、沉船、掠过头顶的蝠鲼。
而这一切全部由代码生成 —— 没有贴图、没有模型、没有音频文件，整个世界装进**一个 96 KB 的 HTML 文件**。

上游项目：[Noniv/abyssal-garden](https://github.com/Noniv/abyssal-garden)（MIT，Copyright © 2026 Maksymilian Dendura）。
本目录在原版基础上修复了三个 iOS 真机缺陷，见下方「iOS 修复」。

## 玩起来

1. 打开 [`index.html`](index.html)（或点上方场景索引进入）。
2. 用 **Chrome / Edge 113+** 或 **Safari 26+** 打开 —— 场景依赖 **WebGPU**。
3. 等几秒世界构建完，按 **Dive in** 开始游。

> ⚠️ **必须是 secure context**：`https://` 或 `http://localhost` / `127.0.0.1` 才会启用 WebGPU。
> 直接用局域网明文 IP 打开（如 `http://192.168.x.x:8000`）会被浏览器拒绝，
> 报 *"This scene needs WebGPU. Try a current Chrome or Edge."*。

## 水下有什么

- **海带森林**随水流摇曳，闪烁着细小的金色与绿色光点
- 从波纹海面洒下的**光柱**，以及在海床上晃动的焦散
- 一艘**木质沉船**、一截**巨大的石鲸尾**、岩拱、峡谷与漂浮的巨石
- **蝠鲼**、鱼群、上升的气泡与漂浮的粒子
- 一处**紫色洞窟**，长着发光的洋红色地被、珊瑚与桶状海绵
- 随听随有的**环境音**：低沉轰鸣、远处鲸鸣、轻柔风铃与气泡声

## 操作

| | 键盘 & 鼠标 |
|---|---|
| 转视角 | 移动鼠标 |
| 游泳 | `W` `A` `S` `D` |
| 上浮 / 下潜 | `E` / `Q` |
| 加速 | 按住 `Shift` |
| 跳到机位 | `1` 到 `6` |
| 菜单 | `Esc` 释放鼠标并打开菜单，**Resume** 返回 |
| 声音开关 | `M`（潜水后开始播放） |
| 性能统计 | `H` |
| 细节等级 | 菜单里的 **Low** / **Medium** / **High**（会重载页面） |

海床、崖壁与岩拱是实心的：你会贴着岩石滑行而不是撞进去，隧道和拱门也照样钻得过。

**触屏**：按住一根手指向前游，滑动转向；第二根手指按下则加速。角落的 `≡` 打开菜单。
手机横屏显示，初始细节等级为 Low 或 Medium。

## iOS 修复（本目录相对上游的改动）

上游有三个在 iOS 真机上会实际发作的缺陷，均已修好：

| # | 症状 | 根因 | 修法 |
|---|---|---|---|
| 1 | **按不动，只能转视角** | 推进力门控写成 `tId >= 0`，而 iOS 的 `Touch.identifier` **可能是负数**（真机实测 `-1627845003`），负数被当成「没按手指」→ 推力恒为 0 | identifier 一律 `>>> 0` 无符号化；**推进力与摇杆门控改用独立的「手指是否按下」标志 `tDown`**，与 identifier 符号彻底解耦 |
| 2 | **iOS 26.1 整屏黑屏** | 渲染管线里多了一个常量 `constants:{ROWS:7}`，Safari/Chrome 顶点着色器编译失败，每帧都丢 | 删除该多余常量 |
| 3 | **无声 / 锁屏后不恢复** | `AudioContext` 首次 resume 失败后可能停在 `interrupted`（不只是 `suspended`），且 rejected promise 未处理 | 状态非 `running` 即尝试 resume 并吞掉 rejection；页面隐藏前淡出再 suspend；设置 `navigator.audioSession.type = 'playback'` |

第 1 条的实测证据（容器内 Chromium 156 + SwiftShader 合成触摸）：

```
按下前  thrust=0.00  down=0  tId=-1
按下中  thrust=0.70  down=1  tId=2667122293   ← 无符号化正确，推力门控生效
松手后  thrust=0.00  down=0
```

### 诊断模式

在场景 URL 后加 `?debug=1`，左下角出现实时 HUD：

| 字段 | 含义 |
|---|---|
| `events` | 收到的触摸事件总数 |
| `last` | 最后一个事件类型（`touchstart` / `touchmove` / `touchend` / `touchcancel`） |
| `touches` / `down` | 当前触点数 / 手指是否按下 |
| `tId` / `ident=[...]` | 归一化后的 identifier 与原始列表 |
| `thrust` / `speed` / `fps` | 当前推力、速度、帧率 |
| `pointer` / `maxTouch` / `standalone` | 指针类型、最大触点数、是否独立 web app |

判读：`events` 一直不涨 → 浏览器或系统层没把触摸交给页面；
`events` 增长且 `down=1` 但 `thrust=0.00` → 推力门控仍有其他逻辑问题。

## 重新构建

`index.html` 是构建产物，源码在 `source/`：

```sh
cd source
npm install
npm run build          # → ../index.html
```

- `source/src/` — 全部源码（`main.js` 触摸与推力、`audio.js` 音频、`world.js` 场景、`shaders.js` 着色器、`math.js`、`quality.js`、`dev.js`）
- `source/template.html` — HTML 模板
- `source/build.mjs` — esbuild 打包脚本
- `source/abyssal-ios-fixes.patch` — 相对上游的**纯源码** diff（8.4 KB）

构建链自证：用**未打补丁**的原始源码重建，产物 md5 与官方线上 `index.html` **逐字节一致**
（`ef07737100515971e7cbe2abb1523b0a`），说明工具链与作者完全一致，diff 是纯补丁、没有夹带世界内容改动。

## 许可

MIT，Copyright © 2026 Maksymilian Dendura（原作者）。见 [LICENSE](LICENSE)。
上游作者：[Noniv/abyssal-garden](https://github.com/Noniv/abyssal-garden)，赞助 [ko-fi](https://ko-fi.com/noniv)。
