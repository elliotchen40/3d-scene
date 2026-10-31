# Veilspire — Landscape Edition

An original browser-based open-world magical academy valley built with Three.js.
Its world, characters, effects, textures, and audio are generated at runtime;
the repository does not include third-party game assets.

Created by Lunaneco.

> **This is the landscape edition.** The game-content systems — quests, combat,
> enemies, the boss, collectibles, equipment, progression, the shop and the
> branching dialogue — have all been removed. What is left is the valley
> itself: the academy, the village, the ruin, the cavern, the weather, and the
> people who live there.
>
> The original full RPG lives at
> [Lunaneco/veilspire](https://github.com/Lunaneco/veilspire).

## Features

- A procedural 3D world with a castle, village, ruins, cavern, weather, and a
  day/night cycle
- Third-person exploration with swimming, flight, climbing, and free camera
- Touch controls with a movement stick, swipe camera, safe-area support, and
  portrait/landscape phone layouts
- A north-up valley map with the terrain, the landmarks, and the player's
  position
- People who keep their own daily round: students sit through lessons in the
  great hall, walk the courtyard at midday, and drift out to the meadow
- Procedurally synthesized ambience and effects

## Requirements

- Node.js 24 recommended; Node.js 20.19+ within 20.x or Node.js 22.12+ is
  supported
- npm
- A modern browser with WebGL 2 support

## Run locally

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. The development server binds to
`127.0.0.1` so it is not exposed to the local network.

For a production build:

```sh
npm run build
npm run preview
```

The generated site is written to `dist/`. `vite preview` is intended only for
local verification, not as a production server.

## Controls

| Action | Input |
| --- | --- |
| Move / sprint / jump / dodge | WASD or arrows / Shift / Space / Q |
| Climb a wall / mantle over | Space to grab, W to climb |
| Fly | G |
| Speak with someone | F |
| Controls panel / profiler | ? or `/` / F3 |
| Touch devices | Left stick to move, swipe the right side to look, and use the on-screen buttons |

## What changed from the original

Deleted outright:

- `src/combat/` — SpellSystem, Enemies, Boss, combatMath
- `src/quests/` — QuestSystem
- `src/systems/` — Equipment, Inventory, Karma, Progression, DialogueTree
- `src/ui/` — ShopPanel, CharacterPanel, DialoguePanel
- `src/world/` — Collectibles, Caches, Plants
- `src/dev/` — CaptureDirector

Reworked:

- `spawnBurst` moved out of `combat/SpellSystem.js` into `world/Particles.js`.
  The castle braziers, the breaking props and the flight trail all use it and
  have nothing to do with combat, so the world layer had to stop depending on
  the combat layer.
- The player lost health, mana, damage, dodge i-frames and the flight lockout.
  `respawnAtStart` became `resetToStart`.
- The NPCs lost hit points, moods, combat reactions and looting. Their
  schedule, their walking, their roles and their chatter are untouched.
- The HUD lost the bars, the spell slots, the lock-on reticle, the target
  plate, the boss bar, the damage vignette, the karma gauges and the counters.
- The map lost the objective card and the enemy and treasure markers; its
  footer now names the place you are standing in.
- The dialogue was rewritten. Every line used to be about what you had killed
  and cleared, so it now talks about the light, the weather and the buildings.
- The ruin braziers were a puzzle you lit with fire magic; they are simply lit
  now. The cavern chest stands open. The training dummies are gone.

## Privacy and security

Veilspire has no backend and sends no gameplay or personal data to a server.

No environment variables or credentials are required. Never add secrets to
client-side code: everything shipped in a browser bundle is public. See
[SECURITY.md](SECURITY.md) for responsible vulnerability reporting.

The repository intentionally excludes dependency folders, build output,
machine-local assistant/editor settings, environment files, certificates, and
private keys. Install exactly the dependency versions recorded in
`package-lock.json` with `npm ci`.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md)
before opening a pull request.

## License

Released under the [MIT License](LICENSE).
