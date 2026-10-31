# Veilspire — 场景版

源自 [Lunaneco/veilspire](https://github.com/Lunaneco/veilspire) 的开放世界魔法学院 RPG。

**本仓库中的版本已移除全部游戏内容**：任务、战斗、敌人、Boss、收集品、装备、进度、
商店、对话分支、声望系统全部删除，只保留**场景、建筑、风景与人物**。

## 保留内容

| 类别 | 内容 |
| --- | --- |
| 场景 | 学院（城堡 + 大厅 + 咒语教室）、Mirefall 村庄、沉没之环遗迹、水晶洞窟 |
| 风景 | 程序化地形、远山、湖泊与水面、instanced 草场与树林、天气（晴/雨/雪/雷）、昼夜循环 |
| 建筑 | 城堡塔楼与城墙、村庄茅屋与码头、遗迹石环与地标石碑、洞窟岩层 |
| 人物 | 玩家角色（法师造型）、10 名按日程活动的学徒、商人 Bramwell、教授 Maelis |

## 操作

- `WASD` / 方向键移动，`Shift` 奔跑，`Space` 跳跃，`Q` 闪避，`G` 飞行
- `F` 与人交谈（对话按时间、天气与你走过的距离变化）
- 鼠标转视角，滚轮缩放，`F3` 性能面板，`?` 开关帮助

## 目录

```
index.html      构建产物入口（部署用，直接静态托管这个目录即可）
assets/         打包后的 JS
source/         源码
  src/
    world/      地形、城堡、村庄、洞窟、天气、植被、粒子特效
    player/     角色控制器、法师模型、跟随相机
    ui/         HUD、小地图、移动端触控
    systems/    对话台词、世界状态
    core/       引擎、输入、调色、性能分析
```

## 重新构建

源码在 `source/` 下：

```sh
cd source
npm install
npm run build
```

产物会输出到 `source/dist/`。把 `dist/` 的内容复制到本目录即可更新部署版本。

> 注意：上游 `index.html` 带 `Content-Security-Policy: script-src 'self'`，禁止内联脚本，
> 所以这个场景无法像 Sidi Bou Said 那样直接注入 importmap —— 必须走 Vite 构建。

## 上游改动摘要

- 删除 `src/combat/`、`src/quests/`、`src/systems/`（除 Dialogue/WorldState）、
  `src/ui/{ShopPanel,CharacterPanel,DialoguePanel}.js`、
  `src/world/{Collectibles,Caches,Plants}.js`、`src/dev/`
- `spawnBurst` 从 `combat/SpellSystem.js` 抽到 `world/Particles.js` —— 城堡火盆、
  道具碎裂、飞行尾迹都在用它，与战斗无关
- Player 去掉 health/mana/takeDamage，`respawnAtStart` 改名 `resetToStart`
- NPC 去掉 hp/dead/mood=hostile/takeHit/loot，保留日程、走动、身份与闲聊
- 遗迹火盆由「施法点燃的谜题」改为常亮景观
- 洞窟宝箱改为常开，训练假人与采集植物整体移除
- 对话台词改写：从战斗成就改为风景与日常

## 许可

MIT，见 `LICENSE`。原始作者 Lunaneco。

上游项目（完整 RPG 版本）：https://lunaneco.github.io/veilspire/
