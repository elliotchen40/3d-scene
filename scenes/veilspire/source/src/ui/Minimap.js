import { CASTLE_PLATEAU, LAKE } from '../world/Terrain.js';
import { RUINS, VILLAGE } from '../world/Settlements.js';
import { CAVERN } from '../world/Cavern.js';

// North-up overview of the valley. The terrain continues beyond these bounds,
// so positions outside the mapped area are clamped to the rim instead of
// disappearing from the map.
//
// There are no objectives, enemies or treasure markers on it any more — it is
// a map of places, and it tells you where you are, not what to do.
const MAP_MIN = -330;
const MAP_MAX = 330;
const MAP_RANGE = MAP_MAX - MAP_MIN;

const LANDMARKS = [
  { label: 'ACADEMY', short: 'A', x: CASTLE_PLATEAU.x, z: CASTLE_PLATEAU.z },
  { label: 'MIREFALL', short: 'M', x: VILLAGE.x, z: VILLAGE.z },
  { label: 'SUNKEN RING', short: 'R', x: RUINS.x, z: RUINS.z },
  { label: 'CRYSTAL CAVERN', short: 'C', x: CAVERN.x, z: CAVERN.z },
];

function mapPercent(value) {
  return Math.max(2.5, Math.min(97.5, ((value - MAP_MIN) / MAP_RANGE) * 100));
}

function setMapPosition(el, x, z) {
  el.style.left = `${mapPercent(x)}%`;
  el.style.top = `${mapPercent(z)}%`;
}

export function playerMarkerRotation(facing) {
  // CSS rotation is clockwise, while the player's yaw increases from south
  // toward east in world space. Mirror the yaw so east points right and west
  // points left on this north-up map.
  return 180 - (facing * 180) / Math.PI;
}

export class Minimap {
  constructor(container, { player }) {
    this.player = player;
    this._worldMarkerTimer = 0;

    const el = document.createElement('section');
    el.id = 'minimap';
    el.setAttribute('aria-label', 'Valley map');
    el.innerHTML = `
      <style>
        #minimap {
          position: absolute;
          top: 78px;
          right: 28px;
          width: 190px;
          color: #e8f0fa;
          font-family: Georgia, serif;
          pointer-events: none;
          user-select: none;
          filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.48));
        }
        #minimap .map-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin: 0 5px 6px;
          color: rgba(225, 235, 250, 0.82);
          font-size: 10px;
          letter-spacing: 2.4px;
          text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
        }
        #minimap .map-head .north {
          color: #d2ad63;
          letter-spacing: 1px;
        }
        #minimap .map-surface {
          position: relative;
          width: 190px;
          height: 190px;
          overflow: hidden;
          border-radius: 50%;
          border: 1px solid rgba(206, 222, 240, 0.48);
          background:
            radial-gradient(circle at 51% 34%, rgba(95, 121, 88, 0.34), transparent 27%),
            radial-gradient(circle at 72% 70%, rgba(49, 100, 115, 0.30), transparent 30%),
            linear-gradient(145deg, rgba(26, 38, 49, 0.94), rgba(8, 14, 24, 0.94));
          box-shadow:
            inset 0 0 0 5px rgba(6, 12, 20, 0.42),
            inset 0 0 36px rgba(0, 0, 0, 0.46),
            0 0 0 1px rgba(8, 12, 20, 0.72);
        }
        #minimap .map-art {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0.78;
        }
        #minimap .map-grid {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background-image:
            linear-gradient(rgba(190, 210, 230, 0.055) 1px, transparent 1px),
            linear-gradient(90deg, rgba(190, 210, 230, 0.055) 1px, transparent 1px);
          background-size: 25% 25%;
        }
        #minimap .landmark {
          position: absolute;
          width: 15px;
          height: 15px;
          transform: translate(-50%, -50%);
          border: 1px solid rgba(210, 220, 230, 0.34);
          border-radius: 50%;
          background: rgba(11, 18, 28, 0.80);
          color: rgba(220, 230, 240, 0.72);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 8px;
          line-height: 15px;
          text-align: center;
        }
        #minimap .player-marker {
          position: absolute;
          z-index: 4;
          width: 18px;
          height: 22px;
          transform: translate(-50%, -50%) rotate(var(--player-rotation, 0deg));
          transform-origin: 50% 50%;
          filter: drop-shadow(0 0 6px rgba(110, 206, 255, 0.95));
          transition: left 0.06s linear, top 0.06s linear;
        }
        #minimap .player-marker::before {
          content: '';
          position: absolute;
          inset: 0;
          clip-path: polygon(50% 0, 94% 92%, 50% 72%, 6% 92%);
          background: #9fdcff;
          border-radius: 3px;
        }
        #minimap .player-marker::after {
          content: '';
          position: absolute;
          left: 50%;
          top: 44%;
          width: 4px;
          height: 4px;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: #effaff;
        }
        #minimap .map-foot {
          margin-top: 7px;
          padding: 7px 10px 8px;
          border: 1px solid rgba(190, 210, 235, 0.26);
          border-radius: 8px;
          background: rgba(8, 12, 22, 0.70);
          line-height: 1.25;
        }
        #minimap .place-kicker {
          color: #d2ad63;
          font-size: 8px;
          letter-spacing: 2px;
          margin-bottom: 3px;
        }
        #minimap .place-name {
          overflow: hidden;
          color: #eef3f9;
          font-size: 11px;
          letter-spacing: 0.45px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        @media (max-width: 780px), (max-height: 620px) {
          #minimap { top: 72px; right: 18px; width: 150px; }
          #minimap .map-surface { width: 150px; height: 150px; }
          #minimap .landmark { transform: translate(-50%, -50%) scale(0.86); }
        }
      </style>
      <div class="map-head"><span>VALLEY MAP</span><span class="north">N ↑</span></div>
      <div class="map-surface">
        <svg class="map-art" viewBox="0 0 200 200" aria-hidden="true">
          <path d="M111 199 C126 170 130 147 143 128 C154 112 175 103 199 101 L199 199 Z"
            fill="rgba(35, 93, 116, 0.42)" stroke="rgba(115, 183, 205, 0.34)" stroke-width="1.2"/>
          <ellipse cx="164" cy="146" rx="31" ry="35"
            fill="rgba(35, 93, 116, 0.32)" stroke="rgba(115, 183, 205, 0.22)" stroke-width="1"/>
          <path d="M108 121 C104 106 101 92 102 78 C103 65 99 54 99 42"
            fill="none" stroke="rgba(191, 165, 112, 0.36)" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M95 40 L102 31 L109 40 M92 43 L102 35 L112 43"
            fill="none" stroke="rgba(210, 220, 230, 0.26)" stroke-width="1.2"/>
          <path d="M20 36 Q49 15 77 26 M122 26 Q159 12 187 44 M12 88 Q28 61 51 63"
            fill="none" stroke="rgba(157, 181, 162, 0.18)" stroke-width="8" stroke-linecap="round"/>
        </svg>
        <div class="map-grid"></div>
        <div class="landmarks"></div>
        <div class="player-marker" aria-hidden="true"></div>
      </div>
      <div class="map-foot" aria-live="polite">
        <div class="place-kicker">YOU ARE HERE</div>
        <div class="place-name">The Valley</div>
      </div>
    `;
    container.appendChild(el);

    this.el = el;
    this.playerMarker = el.querySelector('.player-marker');
    this.placeName = el.querySelector('.place-name');

    const landmarksEl = el.querySelector('.landmarks');
    for (const landmark of LANDMARKS) {
      const marker = document.createElement('div');
      marker.className = 'landmark';
      marker.textContent = landmark.short;
      marker.title = landmark.label;
      marker.setAttribute('aria-label', landmark.label);
      setMapPosition(marker, landmark.x, landmark.z);
      landmarksEl.appendChild(marker);
    }
  }

  update(dt = 1 / 60) {
    const { x, z } = this.player.position;
    setMapPosition(this.playerMarker, x, z);
    const rotation = playerMarkerRotation(this.player.facing);
    this.playerMarker.style.setProperty('--player-rotation', `${rotation.toFixed(1)}deg`);

    // Name the place you are standing in, using the nearest landmark.
    this._worldMarkerTimer -= dt;
    if (this._worldMarkerTimer <= 0) {
      this._worldMarkerTimer = 0.5;
      let best = null, bestD = Infinity;
      for (const landmark of LANDMARKS) {
        const d = Math.hypot(landmark.x - x, landmark.z - z);
        if (d < bestD) { bestD = d; best = landmark; }
      }
      const name = best && bestD < 90 ? best.label : 'The Valley';
      if (this.placeName.textContent !== name) this.placeName.textContent = name;
    }
  }
}
