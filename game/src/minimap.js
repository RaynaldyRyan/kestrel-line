// The radar: a canvas in the HUD's top-left corner, drawn from the map's own
// data — walls, both sites, teammates, the bomb — so it can never disagree
// with the world. Enemies appear only while the player can actually see them
// (main.js passes the seen set each frame); a hidden enemy stays hidden.
import { BOXES, BOUNDS, SITES } from './map.js';

const W = 148;
const H = 148;
const SCALE = Math.min(W / (BOUNDS.maxX - BOUNDS.minX), H / (BOUNDS.maxZ - BOUNDS.minZ));
const OFF_X = (W - (BOUNDS.maxX - BOUNDS.minX) * SCALE) / 2;
const OFF_Y = (H - (BOUNDS.maxZ - BOUNDS.minZ) * SCALE) / 2;

function px(x) {
  return OFF_X + (x - BOUNDS.minX) * SCALE;
}
function py(z) {
  return OFF_Y + (z - BOUNDS.minZ) * SCALE;
}

export function createMinimap(canvas) {
  const g = canvas.getContext('2d');

  function draw(state, player, seen) {
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(16, 19, 26, 0.82)';
    g.fillRect(0, 0, W, H);
    // Walls.
    g.fillStyle = '#4a505c';
    for (const b of BOXES) {
      if (b.h < 2) continue;
      g.fillRect(px(b.x - b.w / 2), py(b.z - b.d / 2), b.w * SCALE, b.d * SCALE);
    }
    // Sites: A teal, B amber.
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      g.strokeStyle = key === 'A' ? '#2dd4bf' : '#f0a830';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(px(s.x), py(s.z), s.r * SCALE, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = key === 'A' ? '#2dd4bf' : '#f0a830';
      g.font = 'bold 11px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(key, px(s.x), py(s.z));
    }
    // Smoke clouds show as pale discs: the radar knows where the haze is.
    for (const s of state.smokes) {
      g.fillStyle = 'rgba(207, 212, 214, 0.35)';
      g.beginPath();
      g.arc(px(s.x), py(s.z), 3 * SCALE, 0, Math.PI * 2);
      g.fill();
    }
    // The charge: carried (a dot on the carrier), dropped, or planted (blinking).
    const bomb = state.bomb;
    if (bomb.mode === 'planted') {
      if (Math.floor(state.time * 2) % 2 === 0) {
        g.fillStyle = '#ff3b2f';
        g.beginPath();
        g.arc(px(bomb.x), py(bomb.z), 4, 0, Math.PI * 2);
        g.fill();
      }
    } else if (bomb.mode === 'dropped') {
      g.fillStyle = '#ff3b2f';
      g.fillRect(px(bomb.x) - 2, py(bomb.z) - 2, 4, 4);
    }
    // Actors: teammates teal, seen enemies red, the bomb carrier ringed.
    for (const a of state.actors) {
      if (!a.alive || a.isPlayer) continue;
      const isMate = a.team === player.team;
      if (!isMate && !seen.has(a.id)) continue;
      g.fillStyle = isMate ? '#2dd4bf' : '#ff3b2f';
      g.beginPath();
      g.arc(px(a.x), py(a.z), 3, 0, Math.PI * 2);
      g.fill();
      if (bomb.mode === 'carried' && bomb.carrier === a.id) {
        g.strokeStyle = '#f0a830';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(px(a.x), py(a.z), 5.5, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // The player: a white arrow that turns with the view.
    const cx = px(player.x);
    const cy = py(player.z);
    const ang = Math.atan2(-Math.cos(player.yaw), -Math.sin(player.yaw));
    g.save();
    g.translate(cx, cy);
    g.rotate(ang + Math.PI / 2);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -6);
    g.lineTo(4, 5);
    g.lineTo(-4, 5);
    g.closePath();
    g.fill();
    g.restore();
  }

  return { draw };
}
