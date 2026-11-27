// ============================================================================
// Abyssal Echo — the game layer
// ============================================================================
// Appended to the Abyssal Garden engine by this scene's build script, so
// everything the engine owns (the camera state F, the rock distance field,
// the audio graph, the render pipelines) is in scope.
//
// The loop: the trench is full of drifting 光核 (light cores). The water is too
// thick to see them, so a sonar ping is how you find them. Deeper cores are
// worth more, but deep water burns air faster and the shallows refill it.
// When the air runs out the dive is over — what you brought up is your score.
//
// The build script injects one call into the engine's scene render pass:
//
//     if (GAME) { GAME.tick(); GAME.draw(r); }
//
// so the cores are drawn with the terrain: depth tested, into the HDR target
// and therefore into the bloom.
//
// Every name here is prefixed: this file shares one scope with the engine,
// where ui, say, tick, hud, rnd, rr and GAME are already taken.
var GAME = null;

// ---------------------------------------------------------------- state
const gS = {
  st: 0,          // 0 idle, 1 diving, 2 out of air, 3 all found
  o2: 100,        // air, %
  sc: 0,          // score
  got: 0,         // cores collected
  np: 0,          // cores in this dive
  t: 0,           // seconds dived
  cd: 0,          // ping cooldown, s
  tgt: -1,        // core the compass points at
  last: -1,       // F[TIME] of the previous tick
  hudT: 0,        // hud throttle
  msgT: 0,        // message timer
  over: 0,        // the end screen is up
  px: new Float32Array(16 * 3),   // core positions
  pv: new Float32Array(16),       // core value
  kn: new Uint8Array(16),         // known: a ping located it
  tk: new Uint8Array(16),         // taken
  fl: new Float32Array(16),       // flare from the last ping
  pb: new Float32Array(16 * 8),   // instance data
  seed: 1,        // local prng state
};
const gN = 12;     // cores per dive
const gBestKey = 'abyssalEcho';

// ---------------------------------------------------------------- prng
// A small xorshift so every dive lays the cores out differently, while a dive
// can still be replayed from the same seed.
const gRnd = (a, b) => {
  let s = gS.seed | 0;
  s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
  gS.seed = s | 0;
  const r = (s >>> 0) / 4294967296;
  return a === undefined ? r : a + (b - a) * r;
};

// ---------------------------------------------------------------- dom
const gHud = document.createElement('div');
gHud.id = 'gh';
gHud.innerHTML = `
<style>
#gh{position:fixed;inset:0;z-index:8;pointer-events:none;font:700 clamp(11px,.55vw+.75vh,26px)/1.4 system-ui,sans-serif;color:#e8fbff;text-shadow:0 1px 6px #000c}
#gh .bx{position:absolute;background:#03222db3;border:1px solid #7ff3ff33;border-radius:.6em;padding:.5em .8em}
#gh .stat{left:1em;bottom:1em;min-width:13em}
#gh .row{display:flex;justify-content:space-between;gap:1.2em}
#gh .row b{color:#9ff6ff}
#gh .bar{height:.5em;margin-top:.45em;border-radius:1em;background:#03131c;overflow:hidden;box-shadow:inset 0 0 0 1px #7ff3ff55}
#gh .bar i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#14a9c4,#9ff6ff)}
#gh .msg{left:50%;bottom:1.3em;transform:translateX(-50%);text-align:center;opacity:0;transition:opacity .3s;white-space:nowrap}
#gh .bear{left:50%;bottom:5.4em;transform:translateX(-50%);display:none;flex-direction:column;align-items:center;gap:.1em}
#gh .bear i{font-style:normal;font-size:1.7em;line-height:1;color:#9ff6ff;display:block}
#gh .bear u{text-decoration:none;font-size:.68em;letter-spacing:.1em;opacity:.85}
#gh .pn{position:absolute;right:1em;bottom:1em;pointer-events:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent;width:5.8em;height:5.8em;border-radius:50%;border:1px solid #7ff3ff66;background:#03222dcc;color:#9ff6ff;font:inherit;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer}
#gh .pn b{font-size:1.05em}
#gh .pn span{font-size:.55em;letter-spacing:.12em;opacity:.75}
#gh .ring{position:absolute;left:50%;top:50%;width:10em;height:10em;margin:-5em 0 0 -5em;border-radius:50%;border:.15em solid #7ff3ff;opacity:0}
#gh .ov{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#03131ce8;pointer-events:auto}
#gh .ov>div{text-align:center;max-width:23em}
#gh .ov h2{font-size:2.2em;margin:0 0 .3em;letter-spacing:.05em}
#gh .ov p{margin:.5em 0 1.2em;font-size:.92em;opacity:.92;line-height:1.7}
#gh .ov button{padding:.7em 1.6em;border:0;border-radius:.5em;background:linear-gradient(#9ff6ff,#19c3d6);color:#03222d;font:800 1em/1.2 inherit;letter-spacing:.12em;cursor:pointer}
</style>
<div class="bx stat">
  <div class="row"><span>得分 <b id="g-sc">0</b></span><span>光核 <b id="g-cnt">0/0</b></span><span>深 <b id="g-dp">0</b> m</span></div>
  <div class="row" style="margin-top:.4em"><span>空气</span><span id="g-o2v">100%</span></div>
  <div class="bar"><i id="g-o2"></i></div>
</div>
<div class="bx msg" id="g-msg"></div>
<div class="bear" id="g-bear"><i id="g-arrow">▲</i><u id="g-dist"></u></div>
<div class="ring" id="g-ring"></div>
<button class="pn" id="g-ping"><b>声呐</b><span id="g-pcd"></span></button>
<div class="ov" id="g-ov"><div><h2 id="g-overt"></h2><p id="g-overb"></p><button id="g-again">再来一次</button></div></div>`;
document.body.appendChild(gHud);
const gEl = {
  sc: gHud.querySelector('#g-sc'), cnt: gHud.querySelector('#g-cnt'), dp: gHud.querySelector('#g-dp'),
  o2v: gHud.querySelector('#g-o2v'), o2: gHud.querySelector('#g-o2'),
  msg: gHud.querySelector('#g-msg'), bear: gHud.querySelector('#g-bear'), arrow: gHud.querySelector('#g-arrow'),
  dist: gHud.querySelector('#g-dist'), ring: gHud.querySelector('#g-ring'),
  ping: gHud.querySelector('#g-ping'), pcd: gHud.querySelector('#g-pcd'),
  ov: gHud.querySelector('#g-ov'), overt: gHud.querySelector('#g-overt'), overb: gHud.querySelector('#g-overb'),
  again: gHud.querySelector('#g-again'),
};
const gShow = (v) => { gHud.style.display = v ? 'block' : 'none'; };
gShow(false);

// ---------------------------------------------------------------- audio
// The engine owns the AudioContext; these are short procedural blips on top of
// it, so they respect the mute key and the iOS resume handling.
const gBlip = (f0, f1, dur, vol, type, delay) => {
  if (!AC || !OUT || muted) return;
  try {
    const t = AC.currentTime + .01 + (delay || 0);
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(OUT);
    o.start(t); o.stop(t + dur + .03);
  } catch {}
};
const gSfxPing = () => { gBlip(1250, 520, .38, .085); gBlip(820, 300, .5, .04, 'sine', .22); };
const gSfxGet = (i) => { const n = [0, 2, 5, 7, 9, 12][i % 6]; gBlip(440 * Math.pow(2, n / 12), 440 * Math.pow(2, n / 12), .5, .075); };
const gSfxDown = () => gBlip(420, 90, 1.1, .12, 'triangle');
const gSfxWin = () => { gBlip(440, 880, .5, .085); gBlip(660, 1320, .6, .065, 'sine', .12); };

// ---------------------------------------------------------------- rock
// The engine bakes a distance field of the rock; sd(0) samples it at the
// camera and leaves the signed distance in metres in CS[0] (negative in open
// water, positive inside rock). Point the camera at a candidate spot, read the
// distance back and put the camera where it was.
const gRock = (x, y, z) => {
  const sx = F[CX], sy = F[CY], sz = F[CZ];
  F[CX] = x; F[CY] = y; F[CZ] = z;
  sd(0);
  const d = CS[0];
  F[CX] = sx; F[CY] = sy; F[CZ] = sz;
  return d;
};
// The camera is a ball of radius 0.5, so a spot is only usable when there is
// that much room around it.
const gOpen = (x, y, z) => gRock(x, y, z) <= -.5;

// ---------------------------------------------------------------- placement
// The anchors are the scene's own landmarks: the viewpoint targets, the
// magenta beds, the ship, the fluke, the arches and the tunnels.
const gAnch = [
  [-9, -10], [58, 8], [-60, 8], [6, -90], [14, 6], [-4, 20], [6, 84], [-58, 8],
  [50, 30], [8, -70], [-36, 44], [-46, -60], [24, 42], [-56, 26], [-44, 38], [-10, 44],
  [12, 24], [-50, -45], [45, -1], [10, -4], [-23, -16], [0, -34], [-40, 44], [19, -15],
  [0, -88], [0, -40], [40, 40], [-30, 20], [20, -50], [-24, -50], [30, 10],
];

// Find the seabed under a column: walk down from just under the surface and
// keep the deepest spot that is still open water.
const gFloor = (x, z) => {
  let best = 0;
  for (let y = -3; y > -51; y -= .75) {
    if (gOpen(x, y, z)) best = y; else break;
  }
  return best;
};

// Lay the cores out for a dive: a different set of anchors each time, dropped
// just above the seabed in open water, spread out and never on top of the diver.
const gPlace = () => {
  const order = gAnch.map((a) => [a[0], a[1]]);
  for (let i = order.length - 1; i > 0; i--) { const j = (gRnd() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
  let n = 0;
  // two passes: the second one is looser (shallower water, wider jitter) so a
  // dive always has the full dozen cores in it
  for (let pass = 0; pass < 2 && n < gN; pass++) {
    const minDepth = pass ? 8 : 13;
    const jit = pass ? 20 : 13;
    for (const a of order) {
      if (n >= gN) break;
      for (let tries = 0; tries < 10 && n < gN; tries++) {
        const x = a[0] + gRnd(-jit, jit), z = a[1] + gRnd(-jit, jit);
        if (!(x === x) || !(z === z)) continue;
        if (hypot(x, z) > 130) continue;
        const fl = gFloor(x, z);
        if (fl > -minDepth) continue;                       // too shallow to be worth a dive
        const y = fl + 1.3 + gRnd(0, 2.4);                 // just above the seabed
        if (y > -4 || !gOpen(x, y, z)) continue;
        if (!gOpen(x, y + 3, z)) continue;                    // reachable from above
        if (Math.hypot(x - F[CX], y - F[CY], z - F[CZ]) < 14) continue;
        let near = 0;
        for (let k = 0; k < n; k++) if (Math.hypot(gS.px[k * 3] - x, gS.px[k * 3 + 1] - y, gS.px[k * 3 + 2] - z) < 15) { near = 1; break; }
        if (near) continue;
        gS.px[n * 3] = x; gS.px[n * 3 + 1] = y; gS.px[n * 3 + 2] = z;
        gS.pv[n] = Math.round(50 + (-y) * 6);               // deeper is worth more
        gS.kn[n] = 0; gS.tk[n] = 0; gS.fl[n] = 0;
        n++;
        break;
      }
    }
  }
  gS.np = n;
};

// ---------------------------------------------------------------- the dive
const gNote = (m, secs) => { gEl.msg.textContent = m; gS.msgT = secs; gEl.msg.style.opacity = 1; };

// Start just under the surface, above the main canyon, looking down into it.
const gStart = () => {
  const spots = [[0, -3, 20], [0, -3, 10], [0, -3, 0], [-8, -3, 16], [8, -3, -18], [0, -4, -40], [0, -3, -80]];
  for (const s of spots) if (gOpen(s[0], s[1], s[2])) { lookAt(s[0], s[1], s[2], s[0] * .4, -34, s[2] - 26); return; }
  lookAt(0, -3, 20, 0, -34, -6);
};

const gBest = () => { try { return +localStorage.getItem(gBestKey) || 0; } catch { return 0; } };
const gSetBest = (v) => { try { if (v > gBest()) localStorage.setItem(gBestKey, v); } catch {} };

const gBegin = () => {
  gS.st = 1; gS.o2 = 100; gS.sc = 0; gS.got = 0; gS.t = 0; gS.cd = 0; gS.tgt = -1; gS.over = 0;
  gS.seed = (Date.now() ^ (gRnd() * 1e9)) | 0;
  gStart();
  F[VX] = F[VY] = F[VZ] = 0; F[MX] = F[MY] = F[MZ] = 0;
  gPlace();
  gShow(true);
  gEl.ov.style.display = 'none';
  gEl.msg.style.opacity = 0; gS.msgT = 0;
  gNote('下潜开始 · 找齐 ' + gS.np + ' 枚光核', 3);
};

const gFinish = (st) => {
  gS.st = st; gS.over = 1;
  gEl.ov.style.display = 'flex';
  const best = gBest();
  if (st === 3) {
    gSetBest(gS.sc);
    gEl.overt.textContent = '全部找齐';
    gEl.overb.innerHTML = gS.np + ' 枚光核 · 用时 ' + gS.t.toFixed(1) + ' 秒 · 剩余空气 ' + Math.round(gS.o2) + '%<br>得分 <b>' + gS.sc + '</b>' + (gS.sc >= best ? ' · 新纪录' : ' · 最佳 ' + best);
    gSfxWin();
  } else {
    gEl.overt.textContent = '氧气耗尽';
    gEl.overb.innerHTML = '找到 ' + gS.got + ' / ' + gS.np + ' 枚光核 · 下潜 ' + gS.t.toFixed(1) + ' 秒<br>得分 <b>' + gS.sc + '</b> · 最佳 ' + best;
    gSfxDown();
  }
  // the pointer is captured while diving, so give it back or the button is unclickable
  if (document.pointerLockElement) document.exitPointerLock();
};

// A ping: it locates the nearest core and lights up the ones that are close.
// Without it you are swimming blind.
const gPing = () => {
  if (gS.st !== 1 || gS.cd > 0 || menu) return;
  gS.cd = 2;
  let near = -1, nd = 1e9, found = 0;
  for (let i = 0; i < gS.np; i++) {
    if (gS.tk[i]) continue;
    const d = Math.hypot(gS.px[i * 3] - F[CX], gS.px[i * 3 + 1] - F[CY], gS.px[i * 3 + 2] - F[CZ]);
    if (d < 45) { gS.fl[i] = 1; gS.kn[i] = 1; found++; }
    if (d < nd) { nd = d; near = i; }
  }
  if (near >= 0) { gS.kn[near] = 1; gS.fl[near] = 1; }
  gS.tgt = near;
  gSfxPing();
  gEl.ring.animate(
    [{ transform: 'scale(.15)', opacity: .9 }, { transform: 'scale(3.4)', opacity: 0 }],
    { duration: 900, easing: 'cubic-bezier(.2,.7,.3,1)' },
  );
  gNote(found ? '声呐回波 · 附近 ' + found + ' 枚光核' : '声呐回波 · 附近没有光核', 1.8);
};

// ---------------------------------------------------------------- per frame
const gTick = () => {
  if (gS.st !== 1) return;
  const now = F[TIME];
  if (gS.last < 0) gS.last = now;
  let dt = now - gS.last;
  gS.last = now;
  if (dt < 0 || dt > .5) dt = 0;
  if (gS.cd > 0) gS.cd = max(0, gS.cd - dt);
  gShow(!(menu && !gS.over));

  if (!menu && !gS.over) {
    gS.t += dt;
    const depth = max(0, -F[CY]);
    const boost = (ks || tN > 1) ? 1.5 : 1;   // sprinting burns more air
    // The shallows are a breather, not a refill: the air only ever goes down,
    // so a dive always ends when the diver runs out of it.
    const burn = depth < 12 ? .25 : .35 + (depth - 12) * .05;
    gS.o2 -= burn * boost * dt;
    if (gS.o2 <= 0) { gS.o2 = 0; gFinish(2); }

    for (let i = 0; i < gS.np; i++) {
      if (gS.tk[i]) continue;
      const dx = gS.px[i * 3] - F[CX], dy = gS.px[i * 3 + 1] - F[CY], dz = gS.px[i * 3 + 2] - F[CZ];
      if (dx * dx + dy * dy + dz * dz > 5.3) continue;
      gS.tk[i] = 1; gS.got++; gS.sc += gS.pv[i]; gS.fl[i] = 1;
      if (gS.tgt === i) gS.tgt = -1;
      gSfxGet(gS.got);
      gNote('光核 · 深 ' + Math.round(-gS.px[i * 3 + 1]) + ' 米 · +' + gS.pv[i], 2);
      if (gS.got >= gS.np) { gFinish(3); break; }
    }
  }

  // the cores: invisible until a ping locates them, then they burn like a lamp
  for (let i = 0; i < gS.np; i++) {
    const o = i * 8;
    gS.fl[i] = max(0, gS.fl[i] - dt * .5);
    gS.pb[o] = gS.px[i * 3]; gS.pb[o + 1] = gS.px[i * 3 + 1]; gS.pb[o + 2] = gS.px[i * 3 + 2];
    gS.pb[o + 3] = .5;
    gS.pb[o + 4] = 1; gS.pb[o + 5] = .74; gS.pb[o + 6] = .34;
    // unknown cores keep a glimmer so the murk has something to hide, but only
    // a ping turns them into a real light
    gS.pb[o + 7] = gS.tk[i] ? 0 : gS.kn[i] ? .3 + gS.fl[i] * .9 : .045;
  }
  Q.writeBuffer(gBufPick, 0, gS.pb);

  // hud, a few times a second
  if (now - gS.hudT > .12) {
    gS.hudT = now;
    const o2 = max(0, min(100, gS.o2));
    gEl.o2.style.width = o2 + '%';
    gEl.o2.style.background = o2 < 25 ? 'linear-gradient(90deg,#c2482f,#ff9d6b)' : 'linear-gradient(90deg,#14a9c4,#9ff6ff)';
    gEl.o2v.textContent = Math.round(o2) + '%';
    gEl.sc.textContent = gS.sc;
    gEl.cnt.textContent = gS.got + '/' + gS.np;
    gEl.dp.textContent = Math.round(max(0, -F[CY]));
    gEl.pcd.textContent = gS.cd > 0 ? gS.cd.toFixed(1) : '';
    gEl.ping.style.opacity = gS.cd > 0 ? .45 : 1;

    // bearing to the nearest core that is on the map
    let bi = -1, bd = 1e9;
    for (let i = 0; i < gS.np; i++) {
      if (gS.tk[i] || !gS.kn[i]) continue;
      const d = Math.hypot(gS.px[i * 3] - F[CX], gS.px[i * 3 + 1] - F[CY], gS.px[i * 3 + 2] - F[CZ]);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi < 0) { gEl.bear.style.display = 'none'; gEl.dist.textContent = ''; }
    else {
      const dx = gS.px[bi * 3] - F[CX], dz = gS.px[bi * 3 + 2] - F[CZ];
      const rel = Math.atan2(dx, -dz) - F[YAW];
      gEl.bear.style.display = 'flex';
      gEl.arrow.style.transform = 'rotate(' + (rel * 180 / PI) + 'deg)';
      gEl.dist.textContent = Math.round(bd) + ' 米 · 深 ' + Math.round(-gS.px[bi * 3 + 1]);
    }
  }
  if (gS.msgT > 0) { gS.msgT -= dt; if (gS.msgT <= 0) gEl.msg.style.opacity = 0; }
};

// ---------------------------------------------------------------- the cores
// One additive sprite per core. Self lit: it keeps a constant glow in the
// murk instead of fading with the fog, so a core you have located is a hint
// of light rather than nothing at all.
const gWPick = S_G + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
struct Pick { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) col: vec3f };
@vertex fn vsPick(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> Pick {
  var o: Pick; let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  let p = a.xyz;
  let d = length(p - g.cam.xyz);
  if (d > 170.0 || dot(p - g.cam.xyz, g.fwd.xyz) < -1.0) { o.cp = vec4f(0.0, 0.0, 2.0, 1.0); return o; }
  let sz = a.w * (0.7 + 0.6 * ss(6.0, 60.0, d));
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = g.vp * vec4f(w, 1.0); o.uv = q;
  o.col = b.xyz * b.w * exp(-d * 0.008);
  return o;
}
@fragment fn fsPick(i: Pick) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  return vec4f(min(i.col * exp(-r * 5.5) * (1.0 - ss(0.6, 1.0, r)), vec3f(9.0)), 0.0);
}
`;

const gIbPick = { arrayStride: 32, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4')] };
const gPPick = scenePipe(mod(gWPick), 'vsPick', 'fsPick', [gIbPick], { strip: true, blend: ADD });
const gBufPick = buf(gS.pb, BU.VERTEX);

// ---------------------------------------------------------------- wiring
GAME = {
  tick: gTick,
  draw(r) {
    r.setPipeline(gPPick); r.setVertexBuffer(0, gBufPick); r.draw(4, gS.np);
  },
};

// The dive starts with the dive button. Resuming from the menu must not restart
// it, so only a finished or idle dive begins here.
$('d').addEventListener('click', () => { if (gS.st !== 1) gBegin(); });

// Ping: the corner button on a phone, space on a keyboard. The engine's own
// touch handling is left alone.
const gDoPing = (e) => { if (e) { e.preventDefault(); e.stopPropagation(); } sound(); gPing(); };
gEl.ping.addEventListener('pointerdown', gDoPing);
gEl.ping.addEventListener('click', (e) => { e.preventDefault(); });
addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  if (menu) return;                       // the menu's own button keeps Space
  e.preventDefault();
  gPing();
});
// The viewpoint keys would teleport the diver mid-dive, so they are off while
// a dive is running.
addEventListener('keydown', (e) => {
  if (gS.st === 1 && e.code >= 'Digit1' && e.code <= 'Digit6') { e.preventDefault(); e.stopPropagation(); }
}, true);
gEl.again.addEventListener('click', () => {
  gBegin();
  ui(false);
  if (!mob) capture();
});

// The end screen hands the pointer back, so the engine would pop the menu open
// again; keep it closed and let the player click the button.
document.addEventListener('pointerlockchange', () => { if (gS.over) ui(false); });

// On a phone the corner button is the ping trigger; on a desktop the key is.
if (!mob) gEl.ping.style.display = 'none';

if (location.search.includes('debug')) {
  globalThis.__gS = gS; globalThis.__aeLook = lookAt; globalThis.__aeOpen = gOpen;
  globalThis.__aePick = { pipe: gPPick, buf: gBufPick, bg: bg0, ubo };
  globalThis.__aeRock = gRock; globalThis.__aeFloor = gFloor; globalThis.__aeAnch = gAnch;
}
