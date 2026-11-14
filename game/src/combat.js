// Gunplay: the weapon table, analytic hitscan (ray against walls, then against
// body boxes and head spheres), damage with headshot multipliers and armour,
// reloads, and grenades with bounce physics and radius damage. No three.js here:
// every hit is computed against the map's colliders and the actors' bodies, so
// the sim and the render can never disagree about a shot.
import { COLLIDERS, raycastWalls, losBlocked } from './map.js';
import { eyeHeight, bodyHeight } from './physics.js';
import { actorById, pushEvent, KILL_REWARD, SMOKE_TIME, FLASH_RANGE, FLASH_BLIND, HELMET_PRICE, KIT_PRICE } from './state.js';

export const WEAPONS = {
  pistol: { name: 'P9 Kestrel', price: 0, damage: 28, headMul: 3, mag: 12, reserve: 48, rate: 0.18, auto: false, spread: 0.006, moveSpread: 0.02, recoil: 0.011, reload: 1.2, range: 60, sound: 'pistol' },
  smg: { name: 'Wasp-9', price: 1200, damage: 16, headMul: 2.5, mag: 25, reserve: 100, rate: 0.085, auto: true, spread: 0.013, moveSpread: 0.032, recoil: 0.007, reload: 1.8, range: 45, sound: 'smg' },
  rifle: { name: 'Harrier AR', price: 2500, damage: 24, headMul: 2.5, mag: 30, reserve: 90, rate: 0.11, auto: true, spread: 0.008, moveSpread: 0.026, recoil: 0.009, reload: 2.2, range: 70, sound: 'rifle' },
  dmr: { name: 'Longbow DMR', price: 3500, damage: 65, headMul: 3, mag: 10, reserve: 30, rate: 0.55, auto: false, spread: 0.002, moveSpread: 0.03, recoil: 0.03, reload: 2.6, range: 90, sound: 'dmr' },
};
export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;
const GRENADE_DAMAGE = 95;
const GRENADE_RADIUS = 6.5;
const GRENADE_FUSE = 2.2;
const SMOKE_FUSE = 1.2;
const FLASH_FUSE = 1.4;
const SMOKE_RADIUS = 3;
export const NADE_DEFS = {
  frag: { name: 'Shard grenade', price: 300 },
  smoke: { name: 'Haze grenade', price: 300 },
  flash: { name: 'Glare grenade', price: 200 },
};
// A defuse kit halves the time its owner needs to take the charge apart.
export function defuseTime(actor) {
  return actor.kit ? 2.5 : 5;
}

function ensureStash(actor) {
  if (!actor.stash) {
    actor.stash = {};
    for (const key of Object.keys(WEAPONS)) {
      actor.stash[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
    }
    actor.stash.pistol = { mag: actor.mag, reserve: actor.reserve };
  }
  return actor.stash;
}

export function switchWeapon(state, actor, key) {
  if (!actor.owned[key] || actor.weapon === key || actor.reloadT > 0) return false;
  const stash = ensureStash(actor);
  stash[actor.weapon] = { mag: actor.mag, reserve: actor.reserve };
  actor.weapon = key;
  actor.mag = stash[key].mag;
  actor.reserve = stash[key].reserve;
  actor.cooldown = Math.max(actor.cooldown, 0.25);
  pushEvent(state, { type: 'switch', actor: actor.id, weapon: key });
  return true;
}

export function buyWeapon(state, key) {
  const player = state.actors[0];
  const def = WEAPONS[key];
  if (!def || state.money < def.price || state.phase !== 'buy') return false;
  state.money -= def.price;
  player.owned[key] = true;
  const stash = ensureStash(player);
  stash[key] = { mag: def.mag, reserve: def.reserve };
  switchWeapon(state, player, key);
  pushEvent(state, { type: 'buy', item: def.name, price: def.price });
  return true;
}

const NADE_FIELD = { frag: 'grenades', smoke: 'smoke', flash: 'flashes' };

export function buyGrenade(state, kind) {
  const player = state.actors[0];
  const k = kind || 'frag';
  const def = NADE_DEFS[k];
  const field = NADE_FIELD[k];
  if (!def || state.money < def.price || state.phase !== 'buy' || player[field] >= 2) return false;
  state.money -= def.price;
  player[field] += 1;
  pushEvent(state, { type: 'buy', item: def.name, price: def.price });
  return true;
}

export function buyArmor(state) {
  const player = state.actors[0];
  if (state.money < ARMOR_PRICE || state.phase !== 'buy' || player.armor) return false;
  state.money -= ARMOR_PRICE;
  player.armor = true;
  pushEvent(state, { type: 'buy', item: 'Vest', price: ARMOR_PRICE });
  return true;
}

export function buyHelmet(state) {
  const player = state.actors[0];
  if (state.money < HELMET_PRICE || state.phase !== 'buy' || player.helmet) return false;
  state.money -= HELMET_PRICE;
  player.helmet = true;
  pushEvent(state, { type: 'buy', item: 'Helmet', price: HELMET_PRICE });
  return true;
}

export function buyKit(state) {
  const player = state.actors[0];
  if (state.money < KIT_PRICE || state.phase !== 'buy' || player.kit) return false;
  state.money -= KIT_PRICE;
  player.kit = true;
  pushEvent(state, { type: 'buy', item: 'Defuse kit', price: KIT_PRICE });
  return true;
}

// Ray against a sphere; returns the distance or Infinity.
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

// Ray against an actor's body box; returns the distance or Infinity.
function rayBody(ox, oy, oz, dx, dy, dz, a) {
  const h = bodyHeight(a);
  let tmin = 0;
  let tmax = Infinity;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const lo = [a.x - 0.34, a.y, a.z - 0.34];
  const hi = [a.x + 0.34, a.y + h, a.z + 0.34];
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return Infinity;
    } else {
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin > 0.001 ? tmin : Infinity;
}

export function aimDirection(actor) {
  const cp = Math.cos(actor.pitch);
  return [
    -Math.sin(actor.yaw) * cp,
    Math.sin(actor.pitch),
    -Math.cos(actor.yaw) * cp,
  ];
}

// One shot. spread is the base cone in radians; moving and airborne shooters
// get the weapon's move spread added by the caller. Returns true when a round
// left the barrel.
export function fireWeapon(state, shooter, spread, moveSpread) {
  const def = WEAPONS[shooter.weapon];
  if (shooter.cooldown > 0 || shooter.reloadT > 0 || shooter.mag <= 0 || !shooter.alive) return false;
  shooter.mag -= 1;
  shooter.cooldown = def.rate;
  const rng = state.rng;
  const dir = aimDirection(shooter);
  const total = spread + moveSpread;
  dir[0] += (rng() * 2 - 1) * total;
  dir[1] += (rng() * 2 - 1) * total;
  dir[2] += (rng() * 2 - 1) * total;
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  dir[0] /= len; dir[1] /= len; dir[2] /= len;
  const ox = shooter.x;
  const oy = shooter.y + eyeHeight(shooter);
  const oz = shooter.z;
  const wallT = Math.min(raycastWalls(ox, oy, oz, dir[0], dir[1], dir[2], def.range), def.range);
  let bestT = wallT;
  let bestActor = null;
  let bestHead = false;
  for (const a of state.actors) {
    if (a === shooter || !a.alive || a.team === shooter.team) continue;
    const headT = raySphere(ox, oy, oz, dir[0], dir[1], dir[2], a.x, a.y + eyeHeight(a) + 0.06, a.z, 0.24);
    const bodyT = rayBody(ox, oy, oz, dir[0], dir[1], dir[2], a);
    const t = Math.min(headT, bodyT);
    if (t < bestT) {
      bestT = t;
      bestActor = a;
      bestHead = headT <= bodyT;
    }
  }
  const hx = ox + dir[0] * bestT;
  const hy = oy + dir[1] * bestT;
  const hz = oz + dir[2] * bestT;
  let killed = false;
  let dealt = 0;
  if (bestActor) {
    dealt = def.damage * (bestHead ? def.headMul : 1);
    killed = damageActor(state, bestActor, dealt, shooter, bestHead);
  }
  pushEvent(state, {
    type: 'shot', actor: shooter.id, weapon: shooter.weapon,
    from: [ox, oy, oz], to: [hx, hy, hz],
    hit: bestActor ? bestActor.id : null, head: bestHead, killed, damage: dealt,
  });
  state.noises.push({ x: shooter.x, z: shooter.z, t: state.time });
  if (state.noises.length > 32) state.noises.splice(0, state.noises.length - 32);
  return true;
}

export function startReload(state, actor) {
  const def = WEAPONS[actor.weapon];
  if (actor.reloadT > 0 || actor.reserve <= 0 || actor.mag >= def.mag || !actor.alive) return false;
  actor.reloadT = def.reload;
  pushEvent(state, { type: 'reload', actor: actor.id, weapon: actor.weapon });
  return true;
}

export function throwGrenade(state, actor, kind) {
  const k = kind || 'frag';
  const field = NADE_FIELD[k];
  if (actor[field] <= 0 || !actor.alive) return false;
  actor[field] -= 1;
  const dir = aimDirection(actor);
  state.grenades.push({
    x: actor.x + dir[0] * 0.5,
    y: actor.y + eyeHeight(actor) - 0.2,
    z: actor.z + dir[2] * 0.5,
    vx: dir[0] * 13 + actor.vx * 0.5,
    vy: dir[1] * 13 + 4.5,
    vz: dir[2] * 13 + actor.vz * 0.5,
    fuse: k === 'smoke' ? SMOKE_FUSE : k === 'flash' ? FLASH_FUSE : GRENADE_FUSE,
    owner: actor.id,
    kind: k,
  });
  pushEvent(state, { type: 'throw', actor: actor.id, kind: k });
  return true;
}

// A smoke cloud blooms where the grenade pops and hangs for SMOKE_TIME
// seconds. Bots cannot see through it (bots.js checks the segment), and the
// renderer's puffs hide the far side from the player too.
function popSmoke(state, g) {
  state.smokes.push({ x: g.x, y: 1.1, z: g.z, t: SMOKE_TIME });
  if (state.smokes.length > 3) state.smokes.splice(0, state.smokes.length - 3);
  pushEvent(state, { type: 'smoke', x: g.x, y: g.y, z: g.z });
}

// A flash blinds every actor in range that has line of sight to the pop and is
// not facing fully away from it. Blindness scales with distance; the thrower
// is not exempt.
function popFlash(state, g) {
  pushEvent(state, { type: 'flashpop', x: g.x, y: g.y, z: g.z });
  state.noises.push({ x: g.x, z: g.z, t: state.time });
  for (const a of state.actors) {
    if (!a.alive) continue;
    const dx = g.x - a.x;
    const dy = g.y - (a.y + eyeHeight(a));
    const dz = g.z - a.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > FLASH_RANGE) continue;
    if (losBlocked(g.x, g.y, g.z, a.x, a.y + eyeHeight(a), a.z)) continue;
    const look = aimDirection(a);
    const dot = (dx * look[0] + dy * look[1] + dz * look[2]) / (d || 1);
    if (dot < -0.3) continue; // facing away: the pop is behind the head
    a.blindT = Math.max(a.blindT, Math.max(0.4, FLASH_BLIND * (1 - d / (FLASH_RANGE + 2))));
  }
}

// True when the segment from p0 to p1 passes through any active smoke cloud.
export function smokeBlocks(x0, y0, z0, x1, y1, z1, smokes) {
  for (const s of smokes) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const len2 = dx * dx + dy * dy + dz * dz || 1;
    let t = ((s.x - x0) * dx + (s.y - y0) * dy + (s.z - z0) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = x0 + dx * t;
    const py = y0 + dy * t;
    const pz = z0 + dz * t;
    if (Math.hypot(s.x - px, s.y - py, s.z - pz) < SMOKE_RADIUS) return true;
  }
  return false;
}

function pointInCollider(x, y, z) {
  for (const c of COLLIDERS) {
    if (x > c.minX - 0.1 && x < c.maxX + 0.1 && y > c.minY - 0.1 && y < c.maxY + 0.1
        && z > c.minZ - 0.1 && z < c.maxZ + 0.1) return true;
  }
  return false;
}

function explodeGrenade(state, g) {
  const owner = actorById(state, g.owner);
  pushEvent(state, { type: 'explosion', x: g.x, y: g.y, z: g.z });
  state.noises.push({ x: g.x, z: g.z, t: state.time });
  for (const a of state.actors) {
    if (!a.alive || (owner && a.team === owner.team)) continue;
    const d = Math.hypot(a.x - g.x, a.y + 1 - g.y, a.z - g.z);
    if (d < GRENADE_RADIUS) {
      const amount = Math.max(10, GRENADE_DAMAGE * (1 - d / GRENADE_RADIUS));
      damageActor(state, a, amount, owner, false);
    }
  }
}

export function damageActor(state, target, amount, attacker, head) {
  if (!target.alive) return false;
  let dealt = amount;
  if (head && target.helmet) dealt *= 0.5;
  if (target.armor) dealt *= 0.5;
  dealt = Math.round(dealt);
  target.hp -= dealt;
  target.flash = 1;
  target.lastDamageFrom = attacker ? attacker.id : -1;
  pushEvent(state, { type: 'damage', target: target.id, from: attacker ? attacker.id : null, amount: dealt, head });
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deadT = 0;
    target.channel = 0;
    target.channelKind = null;
    target.deaths += 1;
    if (attacker) attacker.kills += 1;
    if (state.bomb.carrier === target.id) {
      state.bomb.mode = 'dropped';
      state.bomb.carrier = null;
      state.bomb.x = target.x;
      state.bomb.z = target.z;
      pushEvent(state, { type: 'bombDropped', x: target.x, z: target.z });
    }
    pushEvent(state, {
      type: 'kill', target: target.id, from: attacker ? attacker.id : null,
      head, weapon: attacker ? attacker.weapon : null,
    });
    if (attacker && attacker.isPlayer && target.team !== attacker.team) {
      state.money += KILL_REWARD;
      state.kills += 1;
      state.roundKills += 1;
    }
    if (target.isPlayer) state.deaths += 1;
    return true;
  }
  return false;
}

// Cooldowns, reloads, grenades and smoke, once per fixed step.
export function stepCombat(state, dt) {
  for (const a of state.actors) {
    if (a.cooldown > 0) a.cooldown = Math.max(0, a.cooldown - dt);
    if (a.blindT > 0) a.blindT = Math.max(0, a.blindT - dt);
    if (a.reloadT > 0) {
      a.reloadT -= dt;
      if (a.reloadT <= 0) {
        const def = WEAPONS[a.weapon];
        const take = Math.min(def.mag - a.mag, a.reserve);
        a.mag += take;
        a.reserve -= take;
        a.reloadT = 0;
        pushEvent(state, { type: 'reloaded', actor: a.id });
      }
    }
    if (!a.alive) a.deadT += dt;
    if (a.flash > 0) a.flash = Math.max(0, a.flash - dt * 4);
  }
  for (let i = state.grenades.length - 1; i >= 0; i -= 1) {
    const g = state.grenades[i];
    g.fuse -= dt;
    g.vy -= 18 * dt;
    const nx = g.x + g.vx * dt;
    if (!pointInCollider(nx, g.y, g.z)) g.x = nx; else g.vx *= -0.4;
    const nz = g.z + g.vz * dt;
    if (!pointInCollider(g.x, g.y, nz)) g.z = nz; else g.vz *= -0.4;
    const ny = g.y + g.vy * dt;
    if (ny < 0.12) { g.y = 0.12; g.vy = Math.abs(g.vy) * 0.4; g.vx *= 0.7; g.vz *= 0.7; }
    else if (!pointInCollider(g.x, ny, g.z)) g.y = ny;
    else g.vy *= -0.4;
    if (g.fuse <= 0) {
      if (g.kind === 'smoke') popSmoke(state, g);
      else if (g.kind === 'flash') popFlash(state, g);
      else explodeGrenade(state, g);
      state.grenades.splice(i, 1);
    }
  }
  for (let i = state.smokes.length - 1; i >= 0; i -= 1) {
    state.smokes[i].t -= dt;
    if (state.smokes[i].t <= 0) state.smokes.splice(i, 1);
  }
}
