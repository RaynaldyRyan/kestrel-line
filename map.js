// Halcyon Depot: a dusk-lit industrial compound, 64 by 44 metres. Three lanes run
// north from the Kestrel yard to Site A: Mid (a straight sightline broken by
// crates), Foundry (west, close corners) and Silo Walk (east, one long lane).
// Every wall, crate and barrel is one box in BOXES: the same data drives the
// colliders, the line-of-sight tests and the meshes, so what you see is what
// blocks you. Waypoints sit in the open lanes; every linked pair has a clear
// straight run between it, so bots never need to steer around a wall.
export const BOUNDS = { minX: -32, maxX: 32, minZ: -22, maxZ: 22 };
export const SITE = { x: 0, z: -14, r: 4 };
export const KESTREL_SPAWN = { x: 0, z: 18, yaw: 0 };
export const WARDEN_SPAWN = { x: 0, z: -19, yaw: Math.PI };

// { x, z, w, d, h, k } — a box centred on (x, z), rising from the floor to h.
// k: wall | crate | tall | low | barrel | tank | sign
export const BOXES = [
  // Outer walls.
  { x: 0, z: -22.5, w: 66, d: 1, h: 4.5, k: 'wall' },
  { x: 0, z: 22.5, w: 66, d: 1, h: 4.5, k: 'wall' },
  { x: -32.5, z: 0, w: 1, d: 46, h: 4.5, k: 'wall' },
  { x: 32.5, z: 0, w: 1, d: 46, h: 4.5, k: 'wall' },
  // Lane dividers (gaps at z in [-3,3] for the cross connectors, at z in
  // [-14,-10] for the site approaches, and open south of z = 10).
  { x: -10, z: -18, w: 1, d: 8, h: 3.2, k: 'wall' },
  { x: -10, z: -6.5, w: 1, d: 7, h: 3.2, k: 'wall' },
  { x: -10, z: 6.5, w: 1, d: 7, h: 3.2, k: 'wall' },
  { x: 10, z: -18, w: 1, d: 8, h: 3.2, k: 'wall' },
  { x: 10, z: -6.5, w: 1, d: 7, h: 3.2, k: 'wall' },
  { x: 10, z: 6.5, w: 1, d: 7, h: 3.2, k: 'wall' },
  // Site front wall, one gap in the middle for the Mid entrance.
  { x: -6, z: -10, w: 8, d: 1, h: 3.2, k: 'wall' },
  { x: 6, z: -10, w: 8, d: 1, h: 3.2, k: 'wall' },
  // Mid cover, kept off the centre line so the waypoint run stays clear.
  { x: 2.6, z: 8, w: 2.4, d: 2.4, h: 1.2, k: 'crate' },
  { x: -2.6, z: 1.5, w: 2, d: 2, h: 1.2, k: 'crate' },
  { x: 2.6, z: -3.5, w: 2, d: 2, h: 2.4, k: 'tall' },
  { x: -3.2, z: -6.5, w: 2.4, d: 1, h: 1.1, k: 'low' },
  // Foundry (west) cover.
  { x: -23, z: 10, w: 2.4, d: 2.4, h: 1.2, k: 'crate' },
  { x: -24, z: 0, w: 2, d: 2, h: 2.4, k: 'tall' },
  { x: -20, z: -8, w: 2.4, d: 2.4, h: 1.2, k: 'crate' },
  { x: -26, z: -12, w: 2, d: 2, h: 1.2, k: 'crate' },
  // Silo Walk (east) cover.
  { x: 23, z: 10, w: 2.4, d: 2.4, h: 1.2, k: 'crate' },
  { x: 24, z: 0, w: 2, d: 2, h: 2.4, k: 'tall' },
  { x: 20, z: -8, w: 2.4, d: 2.4, h: 1.2, k: 'crate' },
  { x: 26, z: -12, w: 2, d: 2, h: 1.2, k: 'crate' },
  // Site A props.
  { x: -4.5, z: -16, w: 2, d: 2, h: 1.2, k: 'crate' },
  { x: 4.5, z: -16, w: 2, d: 2, h: 1.2, k: 'crate' },
  // No low wall on the site's north edge: it would sit on the Warden spawn
  // and wedge the bot that spawns there inside its own collider.
  { x: -7, z: -17, w: 2.2, d: 2.2, h: 2.6, k: 'tank' },
  { x: 7, z: -17, w: 2.2, d: 2.2, h: 2.6, k: 'tank' },
  // Barrels (colliders are 1x1 boxes; the mesh is a cylinder).
  { x: -6, z: 6, w: 1, d: 1, h: 1.1, k: 'barrel' },
  { x: 6, z: 6, w: 1, d: 1, h: 1.1, k: 'barrel' },
  { x: -14, z: -4, w: 1, d: 1, h: 1.1, k: 'barrel' },
  { x: 14, z: -4, w: 1, d: 1, h: 1.1, k: 'barrel' },
  { x: -2, z: -12, w: 1, d: 1, h: 1.1, k: 'barrel' },
  { x: 2, z: -12, w: 1, d: 1, h: 1.1, k: 'barrel' },
  // Spawn cover, kept clear of the spawn points and the first steps out.
  { x: -6, z: 13, w: 2, d: 2, h: 1.2, k: 'crate' },
  { x: 6, z: 13, w: 2, d: 2, h: 1.2, k: 'crate' },
];

// Axis-aligned colliders derived from BOXES. A box blocks sight only when it is
// tall enough to stand behind: crates hide a crouched body, not a standing one.
export const COLLIDERS = BOXES.map((b) => ({
  minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
  minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
  minY: 0, maxY: b.h,
  sight: b.h >= 2,
}));

// Waypoint graph. Bots route over it with a breadth-first search; holds are the
// defensive posts the Wardens take at the start of a round.
export const WAYPOINTS = {
  as: { x: 0, z: 18, links: ['am1', 'aw1', 'ae1'] },
  am1: { x: 0, z: 12, links: ['as', 'am2', 'aw1', 'ae1'] },
  am2: { x: 0, z: 5, links: ['am1', 'am3', 'cw', 'ce'] },
  am3: { x: 0, z: -2, links: ['am2', 'am4', 'cw', 'ce'] },
  am4: { x: 0, z: -7, links: ['am3', 'site', 'dm'] },
  site: { x: 0, z: -14, links: ['am4', 'sw', 'se', 'dm'] },
  aw1: { x: -18, z: 14, links: ['as', 'am1', 'aw2'] },
  aw2: { x: -21, z: 5, links: ['aw1', 'aw3', 'cw'] },
  aw3: { x: -19, z: -5, links: ['aw2', 'aw4', 'cw'] },
  aw4: { x: -13, z: -11, links: ['aw3', 'sw', 'dw'] },
  sw: { x: -5, z: -14, links: ['site', 'aw4', 'dw'] },
  ae1: { x: 18, z: 14, links: ['as', 'am1', 'ae2'] },
  ae2: { x: 21, z: 5, links: ['ae1', 'ae3', 'ce'] },
  ae3: { x: 19, z: -5, links: ['ae2', 'ae4', 'ce'] },
  ae4: { x: 13, z: -11, links: ['ae3', 'se', 'de'] },
  se: { x: 5, z: -14, links: ['site', 'ae4', 'de'] },
  cw: { x: -7, z: 0, links: ['am2', 'am3', 'aw2', 'aw3'] },
  ce: { x: 7, z: 0, links: ['am2', 'am3', 'ae2', 'ae3'] },
  ds: { x: 0, z: -19, links: ['dw', 'de', 'dm'] },
  dw: { x: -14, z: -13, links: ['ds', 'sw', 'aw4'] },
  de: { x: 14, z: -13, links: ['ds', 'se', 'ae4'] },
  dm: { x: 0, z: -8, links: ['ds', 'am4', 'site'] },
};

export const ROUTES = {
  mid: ['as', 'am1', 'am2', 'am3', 'am4', 'site'],
  west: ['as', 'aw1', 'aw2', 'aw3', 'aw4', 'sw', 'site'],
  east: ['as', 'ae1', 'ae2', 'ae3', 'ae4', 'se', 'site'],
};

export const HOLDS = [
  { x: -4, z: -15, yaw: Math.PI * 0.5 },
  { x: 4, z: -15, yaw: -Math.PI * 0.5 },
  { x: 0, z: -8, yaw: 0 },
  { x: -14, z: -12, yaw: Math.PI * 0.25 },
];

export function nearestWaypoint(x, z) {
  let best = 'as';
  let bestD = Infinity;
  for (const id of Object.keys(WAYPOINTS)) {
    const w = WAYPOINTS[id];
    const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

// Breadth-first search over the waypoint graph; returns waypoint ids from the
// start (excluded) to the goal (included), or null when unreachable.
export function findPath(fromId, toId) {
  if (fromId === toId) return [];
  const prev = { [fromId]: null };
  const queue = [fromId];
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    for (const next of WAYPOINTS[id].links) {
      if (prev[next] !== undefined) continue;
      prev[next] = id;
      if (next === toId) {
        const path = [next];
        let at = id;
        while (at !== fromId) { path.push(at); at = prev[at]; }
        path.reverse();
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

// Slab test: does the segment from p0 to p1 cross this AABB?
function segmentHitsBox(p0, p1, b) {
  let tmin = 0;
  let tmax = 1;
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const lo = [b.minX, b.minY, b.minZ];
  const hi = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(d[i]) < 1e-9) {
      if (p0[i] < lo[i] || p0[i] > hi[i]) return false;
    } else {
      let t1 = (lo[i] - p0[i]) / d[i];
      let t2 = (hi[i] - p0[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

// True when a tall collider stands between two points (eye height to eye height).
export function losBlocked(x0, y0, z0, x1, y1, z1) {
  const p0 = [x0, y0, z0];
  const p1 = [x1, y1, z1];
  for (const c of COLLIDERS) {
    if (!c.sight) continue;
    if (segmentHitsBox(p0, p1, c)) return true;
  }
  return false;
}

// Nearest distance at which a ray from (x,y,z) along a unit direction hits any
// collider, or Infinity. The ground plane (y = 0) counts as a hit too.
export function raycastWalls(x, y, z, dx, dy, dz, maxDist) {
  let best = Infinity;
  if (dy < -1e-9) {
    const t = -y / dy;
    if (t > 0 && t < best) best = t;
  }
  for (const c of COLLIDERS) {
    let tmin = 0;
    let tmax = maxDist;
    const o = [x, y, z];
    const d = [dx, dy, dz];
    const lo = [c.minX, c.minY, c.minZ];
    const hi = [c.maxX, c.maxY, c.maxZ];
    let ok = true;
    for (let i = 0; i < 3; i += 1) {
      if (Math.abs(d[i]) < 1e-9) {
        if (o[i] < lo[i] || o[i] > hi[i]) { ok = false; break; }
      } else {
        let t1 = (lo[i] - o[i]) / d[i];
        let t2 = (hi[i] - o[i]) / d[i];
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
    }
    if (ok && tmin > 0.001 && tmin < best) best = tmin;
  }
  return best;
}
