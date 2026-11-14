// Bot brains: one think step every 0.15 s (staggered per bot) plus a movement
// step every fixed tick. A bot perceives with a vision cone and a line-of-sight
// test, hears gunshots inside 26 m, routes over the map's waypoint graph, holds
// a post with a slow yaw sweep, and fights in bursts with a human-like reaction
// delay. Wardens converge on the planted site when the charge goes down; the
// Kestrel carrier walks its route to its target site and plants. Smoke blocks
// sight; a flash blinds.
import { WAYPOINTS, ROUTES, HOLDS, SITES, losBlocked, findPath, nearestWaypoint } from './map.js';
import { stepBody, eyeHeight, setCrouch } from './physics.js';
import { fireWeapon, startReload, smokeBlocks, WEAPONS } from './combat.js';
import { actorById } from './state.js';

const THINK_EVERY = 0.15;
// Bots spot enemies out to 24 m: long enough for every real lane fight
// (Mid runs 20 m from am1 to the defender post), short enough that the two
// spawns — 36 m apart down an open Mid — cannot duel each other at round
// start. At 46 m the bots saw each other across the whole map and never left
// spawn.
const SEE_RANGE = 24;
const HEAR_RANGE = 26;
const BOT_SPEED = 0.82;

export function assignBot(actor, role, routeName, holdIndex, targetSite) {
  actor.bot = {
    role, // 'carrier' | 'assault' | 'hold'
    targetSite: targetSite || 'A', // the site a carrier walks to
    route: routeName ? ROUTES[routeName].slice() : [],
    wp: 0,
    hold: holdIndex !== undefined ? HOLDS[holdIndex] : null,
    mode: 'advance',
    target: null,
    targetLostT: 0,
    reactT: 0,
    burstLeft: 0,
    burstPause: 0,
    thinkT: Math.random() * THINK_EVERY,
    heard: null,
    seekPath: null,
    strafeDir: 1,
    strafeT: 0,
    sweepDir: 1,
    wantCrouch: false,
  };
}

function dist2(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}

function turnToward(actor, targetYaw, rate, dt) {
  let d = targetYaw - actor.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const maxTurn = rate * dt;
  actor.yaw += Math.max(-maxTurn, Math.min(maxTurn, d));
}

function yawTo(actor, x, z) {
  return Math.atan2(-(x - actor.x), -(z - actor.z));
}

// One visibility test, shared by the bots' perception and the minimap: in
// range, inside the vision cone, a clear line of sight, and no smoke cloud
// between the two. A blinded actor sees nobody.
export function canSee(state, actor, target) {
  if (actor.blindT > 0 || !target.alive) return false;
  const dx = target.x - actor.x;
  const dz = target.z - actor.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > SEE_RANGE * SEE_RANGE) return false;
  const want = Math.atan2(-dx, -dz);
  let diff = want - actor.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) > 1.0) return false;
  const eyeY = actor.y + eyeHeight(actor);
  const chestY = target.y + eyeHeight(target) - 0.25;
  if (losBlocked(actor.x, eyeY, actor.z, target.x, chestY, target.z)) return false;
  if (smokeBlocks(actor.x, eyeY, actor.z, target.x, chestY, target.z, state.smokes)) return false;
  return true;
}

function visibleEnemies(state, actor) {
  const out = [];
  for (const e of state.actors) {
    if (e.team === actor.team || !e.alive) continue;
    if (!canSee(state, actor, e)) continue;
    out.push({ enemy: e, d2: (e.x - actor.x) ** 2 + (e.z - actor.z) ** 2 });
  }
  out.sort((a, b) => a.d2 - b.d2);
  return out;
}

function routeTo(bot, state, actor, goalId) {
  const from = nearestWaypoint(actor.x, actor.z);
  const path = findPath(from, goalId);
  bot.seekPath = path ? path.slice() : null;
}

function think(state, actor) {
  const bot = actor.bot;
  const rng = state.rng;
  // A flashed bot loses its target at once and stops fighting until it can
  // see again; it keeps moving on its current orders.
  if (actor.blindT > 0) {
    bot.target = null;
    return;
  }
  // Perception: nearest visible enemy, or keep the current target briefly after
  // losing sight of it.
  const seen = visibleEnemies(state, actor);
  if (seen.length > 0) {
    if (bot.target !== seen[0].enemy.id) {
      bot.target = seen[0].enemy.id;
      bot.reactT = 0.5 + rng() * 0.5;
      bot.burstLeft = 0;
      bot.burstPause = 0;
    }
    bot.targetLostT = 0;
  } else if (bot.target !== null) {
    bot.targetLostT += THINK_EVERY;
    if (bot.targetLostT > 1.2) bot.target = null;
  }
  // Hearing: the freshest enemy gunshot inside range becomes a place to check.
  bot.heard = null;
  for (let i = state.noises.length - 1; i >= 0; i -= 1) {
    const n = state.noises[i];
    if (state.time - n.t > 1.5) continue;
    if (dist2(actor.x, actor.z, n.x, n.z) < HEAR_RANGE * HEAR_RANGE) {
      bot.heard = { x: n.x, z: n.z };
      break;
    }
  }
  const isCarrier = state.bomb.carrier === actor.id;
  const planted = state.bomb.mode === 'planted';
  // Decide the mode. Channelling (plant/defuse) is never interrupted by combat.
  if (actor.channel > 0) return;
  if (actor.team === 0) {
    if (isCarrier) {
      const site = SITES[bot.targetSite] || SITES.A;
      const dSite = Math.hypot(actor.x - site.x, actor.z - site.z);
      if (dSite < site.r - 0.5) {
        bot.mode = 'plant';
        actor.channelKind = 'plant';
        return;
      }
      bot.mode = 'advance';
      actor.channelKind = null;
      return;
    }
    if (state.bomb.mode === 'dropped') {
      bot.mode = 'seek';
      routeTo(bot, state, actor, nearestWaypoint(state.bomb.x, state.bomb.z));
      return;
    }
    if (planted) {
      // The charge is down: fall back and guard the planted site.
      bot.mode = 'seek';
      routeTo(bot, state, actor, state.bomb.site === 'B' ? 'siteB' : 'site');
      return;
    }
    bot.mode = bot.target !== null ? 'combat' : 'advance';
  } else {
    if (planted) {
      const dSite = Math.hypot(actor.x - state.bomb.x, actor.z - state.bomb.z);
      if (dSite < SITES.A.r - 0.5 && (state.bomb.defuser === null || state.bomb.defuser === actor.id)) {
        bot.mode = 'defuse';
        actor.channelKind = 'defuse';
        return;
      }
      bot.mode = 'seek';
      routeTo(bot, state, actor, state.bomb.site === 'B' ? 'siteB' : 'site');
      return;
    }
    if (bot.target !== null) { bot.mode = 'combat'; return; }
    if (bot.heard && bot.role === 'hold' && rng() < 0.3) {
      bot.mode = 'seek';
      routeTo(bot, state, actor, nearestWaypoint(bot.heard.x, bot.heard.z));
      return;
    }
    bot.mode = 'hold';
  }
}

function waypointTarget(bot, actor) {
  // Returns the current navigation target { x, z } or null when arrived.
  const list = bot.seekPath || bot.route;
  let index = bot.seekPath ? 0 : bot.wp;
  while (index < list.length) {
    const w = WAYPOINTS[list[index]];
    if (dist2(actor.x, actor.z, w.x, w.z) < 1.2) {
      // Advance the loop index with the waypoint pointer: without it the loop
      // re-checks the same reached waypoint forever (an infinite loop that
      // froze the whole sim the first time a bot ever reached a waypoint).
      if (bot.seekPath) bot.seekPath.splice(0, 1);
      else { bot.wp += 1; index += 1; }
      continue;
    }
    return w;
  }
  return null;
}

function moveToward(state, actor, x, z, dt, speedScale) {
  const dx = x - actor.x;
  const dz = z - actor.z;
  const d = Math.hypot(dx, dz) || 1;
  turnToward(actor, Math.atan2(-dx, -dz), 7, dt);
  return stepBody(actor, dt, dx / d, dz / d, speedScale, false);
}

export function stepBot(state, actor, dt) {
  const bot = actor.bot;
  if (!actor.alive || !bot) return;
  bot.thinkT -= dt;
  if (bot.thinkT <= 0) {
    bot.thinkT = THINK_EVERY;
    think(state, actor);
  }
  // Channelling stands still.
  if (actor.channel > 0) {
    stepBody(actor, dt, 0, 0, 0, false);
    return;
  }
  setCrouch(actor, bot.wantCrouch && bot.mode === 'combat');
  if (bot.mode === 'combat' && bot.target !== null) {
    const target = actorById(state, bot.target);
    if (target && target.alive) {
      const d = Math.hypot(target.x - actor.x, target.z - actor.z);
      turnToward(actor, yawTo(actor, target.x, target.z), 6, dt);
      const chestY = target.y + eyeHeight(target) - 0.25;
      const wantPitch = Math.atan2(chestY - (actor.y + eyeHeight(actor)), d);
      actor.pitch += Math.max(-3 * dt, Math.min(3 * dt, wantPitch - actor.pitch));
      // Strafe across the target's view, switching direction at random.
      bot.strafeT -= dt;
      if (bot.strafeT <= 0) {
        bot.strafeT = 0.7 + state.rng() * 0.8;
        bot.strafeDir = state.rng() < 0.5 ? -1 : 1;
        bot.wantCrouch = state.rng() < 0.25;
      }
      const side = bot.strafeDir;
      const fx = -Math.sin(actor.yaw);
      const fz = -Math.cos(actor.yaw);
      stepBody(actor, dt, -fz * side, fx * side, 0.55, false);
      // Fire in bursts after the reaction delay.
      if (bot.reactT > 0) {
        bot.reactT -= dt;
      } else if (actor.mag <= 0) {
        startReload(state, actor);
      } else if (bot.burstLeft > 0) {
        // Bots miss more at range and against a moving target, so a player who
        // keeps moving and uses cover survives longer than one who stands still.
        const targetSpeed = Math.hypot(target.vx, target.vz);
        const spread = 0.02 + d * 0.0005 + (targetSpeed > 2 ? 0.012 : 0);
        if (fireWeapon(state, actor, spread, 0.01)) bot.burstLeft -= 1;
      } else if (bot.burstPause > 0) {
        bot.burstPause -= dt;
      } else {
        bot.burstLeft = 3 + Math.floor(state.rng() * 3);
        bot.burstPause = 0.5 + state.rng() * 0.5;
      }
      return;
    }
    bot.target = null;
  }
  if (bot.mode === 'hold' && bot.hold) {
    const d2 = dist2(actor.x, actor.z, bot.hold.x, bot.hold.z);
    if (d2 > 1) {
      moveToward(state, actor, bot.hold.x, bot.hold.z, dt, BOT_SPEED);
    } else {
      stepBody(actor, dt, 0, 0, 0, false);
      // Slow sweep across the lane the post watches.
      actor.yaw += bot.sweepDir * 0.25 * dt;
      const base = bot.hold.yaw;
      let diff = actor.yaw - base;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (diff > 0.7) bot.sweepDir = -1;
      if (diff < -0.7) bot.sweepDir = 1;
    }
    return;
  }
  if (bot.mode === 'seek' || bot.mode === 'advance') {
    const goal = bot.mode === 'seek' && state.bomb.mode === 'dropped' && actor.team === 0
      ? { x: state.bomb.x, z: state.bomb.z }
      : waypointTarget(bot, actor);
    if (goal) {
      moveToward(state, actor, goal.x, goal.z, dt, BOT_SPEED);
    } else {
      stepBody(actor, dt, 0, 0, 0, false);
      if (bot.mode === 'seek') bot.mode = actor.team === 0 ? 'advance' : 'hold';
    }
    return;
  }
  // plant / defuse modes stand on the spot; main.js advances the channel.
  stepBody(actor, dt, 0, 0, 0, false);
}
