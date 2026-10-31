import * as THREE from 'three';

// DOM-based HUD: the title, the clock, the speech bubbles over people's heads,
// a location banner, and a controls hint that fades after first input.
//
// There are no bars and no spell slots any more — nothing in this valley can
// be fought, so there is nothing to show a health bar for.

export class HUD {
  constructor(container, player, sky) {
    this.player = player;
    this.sky = sky;

    const el = document.createElement('div');
    el.id = 'hud';
    el.innerHTML = `
      <style>
        #hud { position: absolute; inset: 0; pointer-events: none; font-family: 'Georgia', serif; user-select: none; }
        #clock { position: absolute; top: 20px; right: 28px; color: rgba(225,235,250,0.85);
          font-size: 15px; letter-spacing: 1.5px; text-shadow: 0 1px 4px rgba(0,0,0,0.6); }
        #hint { position: absolute; left: 50%; bottom: 90px; transform: translateX(-50%);
          color: rgba(230,240,255,0.9); background: rgba(8,12,22,0.55); padding: 10px 22px; border-radius: 10px;
          font-size: 14px; letter-spacing: 0.4px; border: 1px solid rgba(180,200,230,0.25);
          transition: opacity 0.25s ease; text-align: center; line-height: 1.7; }
        /* The controls live behind this, so it has to stay clickable even
           though the rest of the HUD lets the mouse through to the game. */
        #helpbtn { position: absolute; top: 16px; right: 92px; width: 27px; height: 27px;
          border-radius: 50%; border: 1px solid rgba(190,210,235,0.45);
          background: rgba(8,12,22,0.6); color: rgba(225,235,250,0.9);
          font-size: 15px; line-height: 25px; text-align: center; cursor: pointer;
          pointer-events: auto; transition: background 0.15s, border-color 0.15s, color 0.15s; }
        #helpbtn:hover { background: rgba(30,44,70,0.85); border-color: rgba(220,235,255,0.8); }
        #helpbtn.on { background: rgba(60,90,140,0.9); border-color: rgba(230,242,255,0.95);
          color: #fff; }
        #title { position: absolute; top: 24px; left: 50%; transform: translateX(-50%);
          color: rgba(235,242,252,0.92); font-size: 26px; letter-spacing: 10px; font-variant: small-caps;
          text-shadow: 0 2px 14px rgba(80,140,220,0.5); }
        #bubbles { position: absolute; inset: 0; pointer-events: none; }
        .bub { position: absolute; transform: translate(-50%, -100%);
          background: rgba(12,17,28,0.82); color: #e6eefa; font-size: 13px; line-height: 1.45;
          padding: 7px 12px; border-radius: 10px; border: 1px solid rgba(190,210,235,0.3);
          max-width: 230px; text-align: center; box-shadow: 0 4px 18px rgba(0,0,0,0.5); }
        .bub::after { content: ''; position: absolute; left: 50%; bottom: -6px;
          transform: translateX(-50%); border-left: 6px solid transparent;
          border-right: 6px solid transparent; border-top: 6px solid rgba(12,17,28,0.82); }
        #toast { position: absolute; right: 28px; top: 96px; color: #e8f0fa; font-size: 13.5px;
          letter-spacing: 1px; opacity: 0; transition: opacity 0.4s;
          background: rgba(8,12,22,0.6); padding: 7px 14px; border-radius: 8px;
          border: 1px solid rgba(190,210,235,0.25); }
        #prompt { position: absolute; left: 50%; bottom: 165px; transform: translateX(-50%);
          color: #e8f0fa; background: rgba(10,14,24,0.7); padding: 8px 18px; border-radius: 8px;
          font-size: 15px; border: 1px solid rgba(190,210,235,0.3); display: none;
          letter-spacing: 0.5px; }
        #banner { position: absolute; left: 50%; top: 38%; transform: translateX(-50%);
          text-align: center; opacity: 0; transition: opacity 0.5s; pointer-events: none; }
        #banner .btitle { font-size: 40px; letter-spacing: 12px; color: #ffe6b0;
          font-variant: small-caps; text-shadow: 0 0 28px rgba(255,190,90,0.8); }
        #banner .bsub { font-size: 14px; letter-spacing: 3px; color: #cfe0f5; margin-top: 8px; }
        #flightbadge { position: absolute; left: 50%; top: 64px; transform: translateX(-50%);
          color: #cfe4ff; font-size: 13px; letter-spacing: 4px; opacity: 0; transition: opacity 0.3s;
          text-shadow: 0 0 12px rgba(120,190,255,0.9); }
        @keyframes fpulse { 0%,100% { opacity: 0.65; } 50% { opacity: 1; } }
      </style>
      <div id="title">veilspire</div>
      <div id="helpbtn" title="Controls">?</div>
      <div id="banner"><div class="btitle"></div><div class="bsub"></div></div>
      <div id="bubbles"></div>
      <div id="toast"></div>
      <div id="prompt"></div>
      <div id="clock">17:12</div>
      <div id="flightbadge">✦ FLIGHT</div>
      <div id="hint">Click to enter &nbsp;·&nbsp; WASD / arrow keys move · Shift sprint · Space jump · Q dodge · G fly<br/>
        <b>F</b> speak with someone · mouse look (camera auto-follows)<br/>
        Walk the valley: the academy, the village, the lake, the high path</div>
    `;
    container.appendChild(el);
    this.clock = el.querySelector('#clock');
    this.hint = el.querySelector('#hint');
    this.bannerEl = el.querySelector('#banner');
    this.bannerTitle = el.querySelector('#banner .btitle');
    this.bannerSub = el.querySelector('#banner .bsub');
    this.toastEl = el.querySelector('#toast');
    this.promptEl = el.querySelector('#prompt');
    this.flightBadge = el.querySelector('#flightbadge');
    this.bubblesEl = el.querySelector('#bubbles');
    this.npcs = null;
    this._bubblePool = [];
    this.camera = null; // wired in main for bubble projection

    // The controls sheet is a toggle on the '?' button rather than something
    // that fades away on its own — once it is gone you need a way back to it.
    // It still opens on first load and steps aside as soon as you start
    // playing, so the first thing on screen is not a wall of key bindings.
    this.helpBtn = el.querySelector('#helpbtn');
    this._helpOpen = true;
    this.helpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHelp();
    });
    this._applyHelp();

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement && this._helpOpen && !this._helpPinned) {
        setTimeout(() => { if (!this._helpPinned) this.toggleHelp(false); }, 3500);
      }
    });

    if (document.documentElement.classList.contains('touch-ui')
        || 'ontouchstart' in window
        || (navigator.maxTouchPoints || 0) > 0) {
      this.hint.innerHTML =
        'Touch controls · left stick move · right swipe look<br/>' +
        'use = speak · jump · dodge · fly on the right';
      this.hint.style.bottom =
        'max(120px, calc(env(safe-area-inset-bottom) + 100px))';
      this.hint.style.maxWidth = '92vw';
      this.hint.style.fontSize = '13px';
      this.hint.style.pointerEvents = 'none';
      const dismiss = () => {
        if (!this._helpPinned && this._helpOpen) this.toggleHelp(false);
      };
      window.addEventListener('touchstart', dismiss, { once: true, passive: true });
    }
  }

  // force: true/false to set explicitly, omitted to flip
  toggleHelp(force) {
    this._helpOpen = force ?? !this._helpOpen;
    if (force === undefined) this._helpPinned = true; // the player asked for it
    this._applyHelp();
    return this._helpOpen;
  }

  _applyHelp() {
    this.hint.style.opacity = this._helpOpen ? '1' : '0';
    this.hint.style.display = this._helpOpen ? 'block' : 'none';
    this.helpBtn.classList.toggle('on', this._helpOpen);
  }

  banner(title, sub = '') {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.bannerEl.style.opacity = '1';
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { this.bannerEl.style.opacity = '0'; }, 2600);
  }

  // Project NPC speech bubbles to screen space, reusing a small element pool
  updateBubbles() {
    if (!this.npcs || !this.camera) return;
    const list = this.npcs.activeBubbles();
    while (this._bubblePool.length < list.length) {
      const d = document.createElement('div');
      d.className = 'bub';
      this.bubblesEl.appendChild(d);
      this._bubblePool.push(d);
    }
    for (let i = 0; i < this._bubblePool.length; i++) {
      const el = this._bubblePool[i];
      const b = list[i];
      if (!b) { el.style.display = 'none'; continue; }
      const v = b.pos.clone().project(this.camera);
      // Hide when behind the camera or far off-screen
      if (v.z > 1 || Math.abs(v.x) > 1.3 || Math.abs(v.y) > 1.3) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'block';
      el.style.left = `${(v.x * 0.5 + 0.5) * 100}%`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * 100}%`;
      el.style.opacity = Math.min(1, b.timer).toFixed(2);
      if (el.textContent !== b.text) el.textContent = b.text;
    }
  }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.toastEl.style.opacity = '0'; }, 2200);
  }

  setPrompt(text) {
    this.promptEl.style.display = text ? 'block' : 'none';
    if (text) this.promptEl.textContent = text;
  }

  update(dt = 1 / 60) {
    const t = this.sky.timeOfDay;
    const hh = Math.floor(t);
    const mm = Math.floor((t - hh) * 60);
    this.clock.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

    this.updateBubbles();
    this.flightBadge.style.opacity = this.player.flying ? '0.9' : '0';
  }
}
