import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { World } from './world/World.js';
import { Player } from './player/Player.js';
import { ThirdPersonCamera } from './player/ThirdPersonCamera.js';
import { HUD } from './ui/HUD.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { NPCManager } from './world/NPCs.js';
import { PropManager } from './world/Props.js';
import { Weather } from './world/Weather.js';
import { WorldState } from './systems/WorldState.js';
import { Profiler } from './core/Profiler.js';
import { Particles } from './world/Particles.js';
import { Minimap } from './ui/Minimap.js';
import { MobileControls } from './ui/MobileControls.js';

// Veilspire — an open world to walk around in.
//
// There are no quests, no enemies and no spells. What is left is the valley:
// the academy on its plateau, the village by the lake, the ruin, the cavern,
// the weather, the light through the day, and the people who live there.

const container = document.getElementById('app');
const engine = new Engine(container);
const mobile = new MobileControls(container, engine.input);

const world = new World(engine.scene);
const player = new Player(engine.scene, world, engine.input, engine.camera);
const camera = new ThirdPersonCamera(engine.camera, player, world, engine.input);
const hud = new HUD(container, player, world.sky);
const audio = new AudioEngine();
player.audio = audio;
hud.camera = engine.camera;

const particles = new Particles(engine.scene);

const worldState = new WorldState();
const npcs = new NPCManager(engine.scene, world, worldState);
hud.npcs = npcs;

const props = new PropManager(engine.scene, world);
const weather = new Weather(engine.scene, engine.camera, audio);
const minimap = new Minimap(container, { player });

const listenerDir = new THREE.Vector3();

// Profiler + adaptive quality (F3 toggles the overlay)
const profiler = new Profiler(engine, container);
engine.profiler = profiler;
profiler.onTierChange = (t) => {
  world.vegetation.setQuality({ grass: t.grass, lowDetailTrees: t.grass < 0.6 });
  world.sky.sun.shadow.mapSize.setScalar(t.shadow);
  world.sky.sun.shadow.map?.dispose();
  world.sky.sun.shadow.map = null;
};
profiler.applyTier(engine.renderer, engine.bloom); // honour the starting tier

// Point lights are expensive, and how expensive depends on how many are lit:
// three.js compiles the count into every material, so a light flicking on or
// off rebuilds the entire program cache — the old distance cull did that every
// quarter second. Instead exactly LIGHT_POOL of them stay enabled, always the
// nearest ones. The count never changes, so the shaders never rebuild, and the
// ones parked far away contribute nothing anyway: every lamp here has a
// falloff distance well under the range at which it would be swapped out.
const LIGHT_POOL = 6;
const allPointLights = [];
engine.scene.traverse((o) => { if (o.isPointLight) allPointLights.push(o); });
const lightRank = allPointLights.map((l) => ({ l, d: 0 }));
let lightCullTimer = 0;
const _lightPos = new THREE.Vector3();

let trailTimer = 0;

// The broom arrives in a scatter of sparks rather than blinking into being
player.onBroomSummoned = () => {
  particles.spawnBurst(player.position.clone().setY(player.position.y + 0.6),
    26, 4, 0xffd27a, 0.8);
};

// Refresh IBL environment as the sky changes (every ~6s real time)
let envTimer = 0;
world.sky.update(0, 0); // prime sky colors before first env bake
world.sky.refreshEnvironment(engine.renderer);

// The valley keeps track of how far you have walked, so the people you pass
// can greet you like a neighbour rather than a stranger.
let lastPlayerPos = player.position.clone();

engine.addSystem({
  update(rawDt, elapsed) {
    const dt = rawDt;
    weather.indoors = world.castle.isInsideHall(player.position);
    weather.update(dt, elapsed);
    world.update(dt, elapsed, weather, player.position);
    npcs.weatherState = weather.state;
    // LOD follows the camera, not the player — flying pulls the view far back
    npcs.viewPos = engine.camera.position;
    npcs.update(dt, elapsed, world.sky.timeOfDay, player.position);
    props.update(dt, particles, audio);
    particles.update(dt);
    minimap.update(dt);
    mobile.update();

    // Walking distance, for the greetings
    worldState.distanceWalked += player.position.distanceTo(lastPlayerPos);
    lastPlayerPos.copy(player.position);

    hud.setPrompt(null);
    const professor = npcs.availableProfessor(player.position);
    const merchant = npcs.nearestMerchant(player.position);
    const speaker = npcs.nearestSpeaker(player.position);
    hud.setPrompt(
      professor ? 'F — speak with Professor Maelis'
      : merchant ? 'F — speak with Bramwell'
      : speaker ? 'F — speak' : null);
    if (engine.input.wasPressed('KeyF')) {
      if (professor) npcs.converse(professor);
      else if (merchant) npcs.converse(merchant);
      else if (speaker) npcs.converse(speaker);
    }

    envTimer += dt;
    if (envTimer > 6) {
      envTimer = 0;
      world.sky.refreshEnvironment(engine.renderer);
    }
    player.update(dt);
    world.sky.setFocus(player.position);
    const elev = world.sky.sunElevation ?? 0.5;
    const dayness = Math.max(0, Math.min(1, (elev + 0.05) * 4));
    audio.update(dt, dayness);
    // Flight: rushing air scaled by speed, and a thin ribbon of sparks so the
    // sense of speed reads visually as well as audibly
    const flySpeed01 = player.flying
      ? Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / 26) : 0;
    audio.setFlightRush(flySpeed01);
    if (flySpeed01 > 0.25) {
      trailTimer -= dt;
      if (trailTimer <= 0) {
        trailTimer = 0.045;
        particles.spawnBurst(player.position.clone().setY(player.position.y + 0.9),
          2, 1.2, 0x9fd8ff, 0.5);
      }
    }
    audio.setListener(engine.camera, engine.camera.getWorldDirection(listenerDir));
    // Cinematic grade follows the hour and the sky
    const duskness = Math.max(0, 1 - Math.abs(elev) / 0.28) * (elev > -0.12 ? 1 : 0);
    engine.grading.applyMood(dayness, duskness, weather.cur.dim, weather.snowCover);
  },
  lateUpdate(dt) {
    camera.update(dt);
    // Underwater: deep teal fog swallows the view
    if (engine.camera.position.y < world.waterLevel) {
      engine.scene.fog.color.setHex(0x0d3540);
      engine.scene.fog.density = 0.045;
    }
    // Hand the light pool to whichever lamps are nearest, on a slow cadence
    lightCullTimer -= dt;
    if (lightCullTimer <= 0) {
      lightCullTimer = 0.25;
      for (const e of lightRank) {
        e.l.getWorldPosition(_lightPos);
        e.d = _lightPos.distanceToSquared(engine.camera.position);
      }
      lightRank.sort((a, b) => a.d - b.d);
      for (let i = 0; i < lightRank.length; i++) lightRank[i].l.visible = i < LIGHT_POOL;
      profiler._litLights = Math.min(LIGHT_POOL, lightRank.length);
    }
    if (engine.input.wasPressed('F3')) profiler.toggle();
    // Pointer lock swallows clicks on the HUD, so '?' does the same job as
    // the button without having to leave the game first
    if (engine.input.wasPressed('Slash')) hud.toggleHelp();
    profiler.render({
      objects: engine.scene.children.length,
      lights: `${profiler._litLights ?? 0}/${allPointLights.length}`,
      instanced: world.vegetation.treeLodNear.length + world.vegetation.treeLodFar.length,
      grass: world.vegetation.grass.count,
      props: props.props.filter((p) => !p.broken).length,
      people: npcs.npcs.length,
    });
    hud.update(dt);
  },
});

engine.start();

if (import.meta.env.DEV) {
  // Fixed camera poses for __game.probe(): the views whose cost actually
  // matters — the approach, the courtyard, the hall, deep forest, the village.
  const PROBE_VIEWS = [
    ['approach', [6, 22, -40], [0, 24, -120]],
    ['court', [2, 32, -95], [-20, 26, -125]],
    ['hall', [-30, 28, -112], [-30, 26, -132]],
    ['forest', [120, 26, 60], [60, 14, -20]],
    ['village', [150, 8, 280], [150, 4, 240]],
  ];

  // Development-only handle for teleport, time control, and inspection.
  // It is removed from production builds.
  window.__game = {
    engine, world, player, camera, npcs, weather, audio, hud,
    props, worldState, profiler, mobile, minimap, particles,
    step(n = 1, dt = 1 / 60) {
      for (let i = 0; i < n; i++) engine.tick(dt);
    },
    // Draw-call/triangle census from fixed camera poses. It renders without
    // advancing the simulation, so the numbers are reproducible between runs.
    probe(views = PROBE_VIEWS) {
      const r = engine.renderer;
      const cam = engine.camera;
      const pos = cam.position.clone();
      const quat = cam.quaternion.clone();
      const playerPos = player.position.clone();
      r.info.autoReset = false;
      const out = {};
      for (const [name, from, to] of views) {
        // Stand the player where the camera is and tick once, so every
        // distance-driven gate (LOD, interior dressing) settles for this view.
        player.position.set(from[0], from[1], from[2]);
        engine.tick(1 / 60);
        cam.position.set(from[0], from[1], from[2]);
        cam.lookAt(to[0], to[1], to[2]);
        cam.updateMatrixWorld(true);
        r.info.reset();
        engine.composer.render();
        out[name] = {
          calls: r.info.render.calls,
          ktris: Math.round(r.info.render.triangles / 1000),
        };
      }
      r.info.autoReset = true;
      player.position.copy(playerPos);
      cam.position.copy(pos);
      cam.quaternion.copy(quat);
      return out;
    },
  };
}
