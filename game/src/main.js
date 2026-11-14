// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. This module owns the round state machine (buy, live, planted,
// over), wires input to the player, drains the sim's events into the HUD, the
// synth and the renderer, and stages the deterministic ?shot= frames the
// screenshots are taken from. The sim itself lives in state, map, physics,
// bots and combat; this file only conducts it.
import { createState, createActor, aliveOf, actorById, pushEvent, TEAM, PHASE, BUY_TIME, ROUND_TIME, PLANT_TIME, DEFUSE_TIME, FUSE_TIME, ROUNDS_TO_WIN, WIN_REWARD, LOSS_REWARD, START_MONEY } from './state.js';
import { SITE, KESTREL_SPAWN, WARDEN_SPAWN, losBlocked } from './map.js';
import { stepBot, assignBot } from './bots.js';
import { fireWeapon, startReload, switchWeapon, throwGrenade, buyWeapon, buyGrenade, buyArmor, stepCombat, WEAPONS } from './combat.js';
import { stepPlayer, applyLook, applyRecoil } from './player.js';
import { separate, eyeHeight } from './physics.js';
import { createRender } from './render.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
// ?quality=low turns shadows and antialiasing off for weak machines; the sim
// is identical, only the picture is cheaper.
const lowQuality = params.get('quality') === 'low';

const state = createState(seed);
const render = createRender(document.getElementById('game'), { lowQuality });
const audio = createAudio();
const hud = createHud({
  onPlay,
  onBuy: (key) => {
    if (key === 'grenade') buyGrenade(state);
    else if (key === 'armor') buyArmor(state);
    else if (key === 'pistol') switchWeapon(state, player, 'pistol');
    else buyWeapon(state, key);
    audio.buy();
    refreshBuy();
  },
});
const input = createInput(render.dom, onLockChange);

let player = null;
let started = false;
let buyOpen = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let prevFiring = false;
const EMPTY_KEYS = new Set();
let shake = 0;
let flashT = -1;
let lastBeep = 0;
let spectateTarget = null;

function setupActors() {
  state.actors.length = 0;
  state.grenades.length = 0;
  state.noises.length = 0;
  state.events.length = 0;
  const p = createActor('Falcon', TEAM.KESTREL, true, KESTREL_SPAWN.x, KESTREL_SPAWN.z, KESTREL_SPAWN.yaw);
  const rook = createActor('Rook', TEAM.KESTREL, false, -2, 19, 0);
  const sable = createActor('Sable', TEAM.KESTREL, false, 2, 19, 0);
  const vex = createActor('Vex', TEAM.WARDEN, false, -2, -19, Math.PI);
  const onyx = createActor('Onyx', TEAM.WARDEN, false, 2, -19, Math.PI);
  const bram = createActor('Bram', TEAM.WARDEN, false, 0, -18, Math.PI);
  const koda = createActor('Koda', TEAM.WARDEN, false, -4, -19, Math.PI);
  state.actors.push(p, rook, sable, vex, onyx, bram, koda);
  player = p;
  assignBot(rook, 'assault', 'west');
  assignBot(sable, 'assault', 'east');
  assignBot(vex, 'hold', null, 0);
  assignBot(onyx, 'hold', null, 1);
  assignBot(bram, 'hold', null, 2);
  assignBot(koda, 'hold', null, 3);
  // Bot loadouts: allies take rifles; the Wardens mix rifles, an SMG and a DMR.
  giveLoadout(rook, 'rifle');
  giveLoadout(sable, 'rifle');
  giveLoadout(vex, 'rifle');
  giveLoadout(onyx, 'smg');
  giveLoadout(bram, 'dmr');
  giveLoadout(koda, 'rifle');
  return p;
}

function giveLoadout(actor, key) {
  const def = WEAPONS[key];
  actor.owned[key] = true;
  actor.weapon = key;
  actor.mag = def.mag;
  actor.reserve = def.reserve;
}

function startRound(n) {
  state.round = n;
  state.roundKills = 0;
  setupActors();
  // The player keeps bought weapons across rounds; ammo is refilled, armour is not.
  const def = WEAPONS[player.weapon];
  player.mag = def.mag;
  player.reserve = def.reserve;
  player.armor = false;
  state.bomb = { mode: 'carried', carrier: player.id, x: player.x, z: player.z, fuse: 0, planter: null, defuser: null, plantP: 0, defuseP: 0 };
  state.phase = PHASE.BUY;
  state.phaseT = BUY_TIME;
  state.overReason = '';
  spectateTarget = null;
  hud.setSpectating(null);
  hud.hideBanner();
  hud.setBomb(null, 0);
  hud.setChannel(null, 0);
  hud.banner(`ROUND ${n}`, 'Buy phase — press B for the shop', 3000);
  hud.setScore(state.wins[0], state.wins[1], n);
  syncHudStatic();
}

function resetMatch() {
  state.wins = [0, 0];
  state.money = START_MONEY;
  state.kills = 0;
  state.deaths = 0;
  state.matchOver = false;
  state.matchWinner = -1;
  state.round = 1;
}

function endRound(winner, reason) {
  if (state.phase === PHASE.OVER) return;
  state.phase = PHASE.OVER;
  state.phaseT = 4.5;
  state.overReason = reason;
  state.wins[winner] += 1;
  const playerWon = winner === TEAM.KESTREL;
  state.money += playerWon ? WIN_REWARD : LOSS_REWARD;
  hud.banner(
    playerWon ? 'ROUND TO THE KESTRELS' : 'ROUND TO THE WARDENS',
    `${reason}  ·  +$${playerWon ? WIN_REWARD : LOSS_REWARD}`,
    4200,
  );
  audio.roundWin(playerWon);
  closeBuy();
  if (state.wins[winner] >= ROUNDS_TO_WIN) {
    state.matchOver = true;
    state.matchWinner = winner;
  }
  pushEvent(state, { type: 'roundEnd', winner, reason });
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.resume();
    hud.hideOverlay();
  } else if (!state.matchOver) {
    hud.showOverlay(started ? 'pause' : 'start', { round: state.round, wins: state.wins });
  }
}

function onPlay() {
  if (state.matchOver) {
    resetMatch();
    startRound(1);
  }
  audio.resume();
  input.requestLock();
}

function openBuy() {
  if (state.phase !== PHASE.BUY || !player.alive || buyOpen) return;
  buyOpen = true;
  refreshBuy();
  hud.showBuy(true);
  input.exitLock();
}

function closeBuy() {
  if (!buyOpen) return;
  buyOpen = false;
  hud.showBuy(false);
  if (started && !state.matchOver) input.requestLock();
}

function refreshBuy() {
  hud.refreshBuy(state.money, player.owned, player.grenades, player.armor);
  hud.setMoney(state.money);
}

function formatTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function syncHudStatic() {
  hud.setScore(state.wins[0], state.wins[1], state.round);
  hud.setMoney(state.money);
  hud.setWeapon(WEAPONS[player.weapon].name.toUpperCase());
  hud.setAmmo(player.mag, player.reserve, player.reloadT > 0);
  hud.setHealth(player.hp, player.armor);
  hud.setGrenades(player.grenades);
  hud.setAlive(aliveOf(state, TEAM.KESTREL), aliveOf(state, TEAM.WARDEN));
  hud.setTeammates(state.actors.filter((a) => a.team === TEAM.KESTREL));
}

function drainEvents() {
  for (const e of state.events) {
    if (e.type === 'shot') {
      render.addTracer(e.from, e.to);
      const shooter = actorById(state, e.actor);
      const distant = !shooter || !shooter.isPlayer;
      audio.shoot(e.weapon, distant);
      if (shooter && shooter.isPlayer) {
        render.muzzle();
        flashT = state.time;
        if (e.hit !== null) hud.hitmarker(e.killed, e.head);
        if (e.killed) audio.hit(true);
        else if (e.hit !== null) audio.hit(false);
      }
      if (e.hit !== null) {
        const victim = actorById(state, e.hit);
        if (victim && victim.isPlayer) {
          hud.damageFlash();
          audio.hurt();
          shake = Math.min(1, shake + 0.4);
        }
      }
    } else if (e.type === 'kill') {
      const killer = e.from !== null ? actorById(state, e.from) : null;
      const victim = actorById(state, e.target);
      if (killer && victim) {
        hud.killfeed(killer.isPlayer ? 'YOU' : killer.name, victim.isPlayer ? 'YOU' : victim.name, e.head, killer.team);
      }
      if (victim && victim.isPlayer) {
        hud.hint('You are down — spectating a teammate', 4000);
      }
      hud.setAlive(aliveOf(state, TEAM.KESTREL), aliveOf(state, TEAM.WARDEN));
    } else if (e.type === 'damage') {
      const victim = actorById(state, e.target);
      if (victim && victim.isPlayer) {
        hud.damageFlash();
        audio.hurt();
      }
    } else if (e.type === 'explosion') {
      render.explosion(e.x, e.y, e.z);
      audio.explosion();
      const d = Math.hypot(player.x - e.x, player.z - e.z);
      shake = Math.min(1.2, shake + Math.max(0, 1.2 - d / 10));
    } else if (e.type === 'reload' && e.actor === player.id) {
      audio.reload();
    } else if (e.type === 'buy') {
      hud.setMoney(state.money);
    } else if (e.type === 'bombDropped') {
      hud.hint('Charge dropped — a teammate can pick it up', 3500);
    } else if (e.type === 'throw' && e.actor === player.id) {
      audio.throwGrenade();
    } else if (e.type === 'switch' && e.actor === player.id) {
      hud.setWeapon(WEAPONS[player.weapon].name.toUpperCase());
      audio.click();
    }
  }
  state.events.length = 0;
}

// The bomb: planting, fusing, defusing, pickup. Progress lives on the bomb so
// a channel survives a change of hands; the actor's channel mirrors it for the HUD.
function stepBomb(dt) {
  const bomb = state.bomb;
  if (bomb.mode === 'carried') {
    const carrier = actorById(state, bomb.carrier);
    if (!carrier || !carrier.alive) return;
    bomb.x = carrier.x;
    bomb.z = carrier.z;
    const inSite = Math.hypot(carrier.x - SITE.x, carrier.z - SITE.z) < SITE.r;
    const wantsPlant = carrier.isPlayer
      ? input.keys.has('KeyE') && carrier.alive
      : carrier.channelKind === 'plant';
    if (inSite && wantsPlant && state.phase === PHASE.LIVE) {
      bomb.planter = carrier.id;
      bomb.plantP += dt / PLANT_TIME;
      carrier.channel = bomb.plantP;
      if (bomb.plantP >= 1) {
        bomb.mode = 'planted';
        bomb.fuse = FUSE_TIME;
        bomb.carrier = null;
        bomb.planter = null;
        carrier.channel = 0;
        carrier.channelKind = null;
        state.phase = PHASE.PLANTED;
        state.phaseT = FUSE_TIME;
        hud.banner('CHARGE PLANTED', 'Defend Site A until it detonates', 3000);
        audio.plant();
        pushEvent(state, { type: 'planted' });
      }
    } else {
      bomb.plantP = 0;
      bomb.planter = null;
      if (carrier.channelKind === 'plant') carrier.channel = 0;
    }
  } else if (bomb.mode === 'dropped') {
    for (const a of state.actors) {
      if (!a.alive || a.team !== TEAM.KESTREL) continue;
      if (Math.hypot(a.x - bomb.x, a.z - bomb.z) < 1.6) {
        bomb.mode = 'carried';
        bomb.carrier = a.id;
        bomb.plantP = 0;
        pushEvent(state, { type: 'bombPicked', actor: a.id });
        if (a.isPlayer) hud.hint('You picked up the charge — take it to Site A', 3000);
        break;
      }
    }
  } else if (bomb.mode === 'planted') {
    bomb.fuse -= dt;
    state.phaseT = bomb.fuse;
    const interval = bomb.fuse < 5 ? 0.5 : 1;
    if (state.time - lastBeep > interval) {
      lastBeep = state.time;
      audio.beep();
    }
    // Defusing: one Warden channels at a time; progress is shared.
    let defuser = bomb.defuser ? actorById(state, bomb.defuser) : null;
    if (defuser && (!defuser.alive || defuser.channelKind !== 'defuse'
        || Math.hypot(defuser.x - bomb.x, defuser.z - bomb.z) >= SITE.r)) {
      defuser.channel = 0;
      defuser.channelKind = null;
      bomb.defuser = null;
      defuser = null;
    }
    if (!defuser) {
      for (const a of state.actors) {
        if (!a.alive || a.team !== TEAM.WARDEN) continue;
        if (a.channelKind === 'defuse' && Math.hypot(a.x - bomb.x, a.z - bomb.z) < SITE.r) {
          bomb.defuser = a.id;
          defuser = a;
          break;
        }
      }
    }
    if (defuser) {
      bomb.defuseP += dt / DEFUSE_TIME;
      defuser.channel = bomb.defuseP;
      if (bomb.defuseP >= 1) {
        bomb.mode = 'gone';
        defuser.channel = 0;
        defuser.channelKind = null;
        endRound(TEAM.WARDEN, 'Charge defused');
        return;
      }
    }
    if (bomb.fuse <= 0) {
      bomb.mode = 'gone';
      pushEvent(state, { type: 'explosion', x: bomb.x, y: 1, z: bomb.z });
      endRound(TEAM.KESTREL, 'Charge detonated');
    }
  }
}

function checkRoundEnd() {
  if (state.phase === PHASE.OVER) return;
  const k = aliveOf(state, TEAM.KESTREL);
  const w = aliveOf(state, TEAM.WARDEN);
  if (w === 0) { endRound(TEAM.KESTREL, 'Wardens eliminated'); return; }
  if (k === 0) { endRound(TEAM.WARDEN, 'Kestrels eliminated'); return; }
  if (state.phase === PHASE.LIVE && state.phaseT <= 0) {
    endRound(TEAM.WARDEN, 'Time expired');
  }
}

function step(dt) {
  state.time += dt;
  if (state.phase === PHASE.BUY) {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      state.phase = PHASE.LIVE;
      state.phaseT = ROUND_TIME;
      closeBuy();
      hud.hint('Go — plant the charge at Site A', 3000);
    }
  } else if (state.phase === PHASE.LIVE) {
    state.phaseT -= dt;
  } else if (state.phase === PHASE.OVER) {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      if (state.matchOver) {
        hud.showOverlay('match', { winner: state.matchWinner, wins: state.wins, kills: state.kills, deaths: state.deaths });
        input.exitLock();
        state.phaseT = 9999;
      } else {
        startRound(state.round + 1);
      }
    }
  }

  // Player.
  if (player.alive && state.phase !== PHASE.OVER) {
    const speed = stepPlayer(player, input.keys, dt);
    player.groundSpeed = speed;
  } else if (!player.alive) {
    stepPlayer(player, EMPTY_KEYS, dt);
  }
  // Bots move only once the round is live.
  if (state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED) {
    for (const a of state.actors) {
      if (!a.isPlayer && a.bot) stepBot(state, a, dt);
    }
  }
  stepCombat(state, dt);
  separate(state.actors);
  stepBomb(dt);
  checkRoundEnd();
}

function handleShooting() {
  if (!player.alive || buyOpen || state.phase === PHASE.BUY || state.phase === PHASE.OVER) {
    prevFiring = input.firing;
    return;
  }
  const def = WEAPONS[player.weapon];
  const wantFire = def.auto ? input.firing : input.firing && !prevFiring;
  prevFiring = input.firing;
  if (!wantFire) return;
  if (player.mag <= 0) {
    audio.dryFire();
    startReload(state, player);
    return;
  }
  const speed = player.groundSpeed || 0;
  const speedFactor = Math.min(1, speed / 5.4);
  let spread = def.spread + def.moveSpread * speedFactor;
  if (!player.onGround) spread += 0.02;
  if (player.crouch) spread -= 0.002;
  if (input.aiming) spread *= 0.5;
  if (fireWeapon(state, player, Math.max(0.001, spread), 0)) {
    applyRecoil(player, def.recoil * (0.8 + state.rng() * 0.4), (state.rng() * 2 - 1) * def.recoil * 0.4);
  }
}

function handleKeys() {
  if (input.takePressed('KeyB')) {
    if (buyOpen) closeBuy();
    else openBuy();
  }
  if (buyOpen) {
    const buys = { Digit1: 'rifle', Digit2: 'smg', Digit3: 'dmr', Digit4: 'grenade', Digit5: 'armor' };
    for (const code of Object.keys(buys)) {
      if (input.takePressed(code)) {
        const key = buys[code];
        if (key === 'grenade') buyGrenade(state);
        else if (key === 'armor') buyArmor(state);
        else buyWeapon(state, key);
        audio.buy();
        refreshBuy();
      }
    }
    if (input.takePressed('Escape')) closeBuy();
    return;
  }
  if (input.takePressed('KeyR')) startReload(state, player);
  if (input.takePressed('KeyG')) {
    if (throwGrenade(state, player)) hud.setGrenades(player.grenades);
  }
  if (input.takePressed('Digit1')) switchWeapon(state, player, 'pistol');
  if (input.takePressed('Digit2')) {
    const primary = ['rifle', 'dmr', 'smg'].find((k) => player.owned[k]);
    if (primary) switchWeapon(state, player, primary);
  }
}

function syncHud() {
  syncHudStatic();
  if (state.phase === PHASE.BUY) hud.setTimer(`BUY ${formatTime(state.phaseT)}`, false);
  else if (state.phase === PHASE.PLANTED) hud.setTimer(formatTime(state.phaseT), true);
  else if (state.phase === PHASE.OVER) hud.setTimer('—', false);
  else hud.setTimer(formatTime(state.phaseT), state.phaseT < 10);
  const def = WEAPONS[player.weapon];
  const speed = player.groundSpeed || 0;
  const spreadPx = 5 + (def.spread + def.moveSpread * Math.min(1, speed / 5.4)) * 900;
  hud.setSpread(spreadPx);
  if (state.bomb.mode === 'planted') {
    hud.setBomb(`BOMB PLANTED — ${formatTime(state.bomb.fuse)}`, state.bomb.fuse / FUSE_TIME);
  } else if (state.bomb.mode === 'carried' && state.bomb.carrier === player.id) {
    hud.setBomb('YOU CARRY THE CHARGE — E TO PLANT AT SITE A', 1);
  } else if (state.bomb.mode === 'dropped') {
    hud.setBomb('CHARGE DROPPED', 1);
  } else {
    hud.setBomb(null, 0);
  }
  if (player.channel > 0) {
    hud.setChannel(player.channelKind, player.channel);
  } else {
    const planter = state.bomb.planter ? actorById(state, state.bomb.planter) : null;
    const defuser = state.bomb.defuser ? actorById(state, state.bomb.defuser) : null;
    if (planter && planter !== player) hud.setChannel('plant', state.bomb.plantP);
    else if (defuser) hud.setChannel('defuse', state.bomb.defuseP);
    else hud.setChannel(null, 0);
  }
  if (!player.alive && (state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED)) {
    if (!spectateTarget || !spectateTarget.alive) {
      spectateTarget = state.actors.find((a) => a.team === TEAM.KESTREL && a.alive && !a.isPlayer) || null;
      hud.setSpectating(spectateTarget ? spectateTarget.name : null);
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (input.locked && player.alive) applyLook(player, look.x, look.y);
    handleKeys();
    if (input.locked) handleShooting();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    drainEvents();
    syncHud();
  }
  shake = Math.max(0, shake - dt * 2.5);
  const subject = !player.alive && spectateTarget ? spectateTarget : player;
  render.sync(state, dt, { subject, aiming: input.aiming && player.alive, shake, time: state.time, flashT });
}

// Deterministic frames for the screenshots. Each one sets up a live game,
// settles the simulation, aims the camera, and freezes with __shotReady set.
function settle(seconds) {
  const steps = Math.round(seconds / FIXED_STEP);
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
  drainEvents();
}

function aimAt(actor, x, y, z) {
  const dx = x - actor.x;
  const dy = y - (actor.y + eyeHeight(actor));
  const dz = z - actor.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  actor.yaw = Math.atan2(-dx, -dz);
  actor.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
}

function nearestVisibleEnemy() {
  // The nearest enemy the player can actually see. Returns null when every
  // enemy is behind cover: aiming at a hidden enemy puts the crosshair on a
  // wall and no bot in the frame.
  let best = null;
  let bestD = Infinity;
  const eyeY = player.y + eyeHeight(player);
  for (const a of state.actors) {
    if (a.team === TEAM.KESTREL || !a.alive) continue;
    const d = Math.hypot(a.x - player.x, a.z - player.z);
    const chestY = a.y + eyeHeight(a) - 0.25;
    if (losBlocked(player.x, eyeY, player.z, a.x, chestY, a.z)) continue;
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

function runShot(name) {
  hud.hideOverlay();
  started = true;
  // Staging is a photoshoot, not a fair fight: nobody can die while the scene
  // settles, and health is restored to full before the frame is taken. The
  // round-start banner is hidden too: it runs on wall-clock time, so it would
  // otherwise still be up when the synchronous staging freezes the frame.
  hud.hideBanner();
  for (const a of state.actors) a.hp = 100000;
  if (name === 'buy') {
    // Round 1 buy phase, shop open, allies at the spawn.
    settle(0.5);
    aimAt(player, -2, 1.5, 14);
    buyOpen = true;
    refreshBuy();
    hud.showBuy(true);
  } else if (name === 'site') {
    // Charge planted at Site A; the player covers the site from its west edge
    // while a Warden closes in to defuse.
    giveLoadout(player, 'rifle');
    state.phase = PHASE.LIVE;
    state.phaseT = ROUND_TIME;
    player.x = 4.5;
    player.z = -11;
    state.bomb.mode = 'planted';
    state.bomb.carrier = null;
    state.bomb.x = 0;
    state.bomb.z = -14;
    state.bomb.fuse = 28;
    state.phase = PHASE.PLANTED;
    state.phaseT = 28;
    settle(2.5);
    render.clearFx();
    aimAt(player, 0, 0.6, -14);
    hud.banner('CHARGE PLANTED', 'Defend Site A until it detonates');
  } else if (name === 'grenade') {
    // A grenade mid-flight down Foundry lane.
    giveLoadout(player, 'rifle');
    player.grenades = 1;
    state.phase = PHASE.LIVE;
    state.phaseT = ROUND_TIME;
    player.x = -16;
    player.z = 8;
    settle(4);
    render.clearFx();
    aimAt(player, -19, 1.2, -6);
    throwGrenade(state, player);
    settle(0.55);
    const g = state.grenades[0];
    if (g) aimAt(player, g.x, g.y, g.z);
  } else {
    // Cover: mid-combat on Mid, rifle out, a Warden in the sights. The player
    // waits at the spawn while the scene settles — from there the Wardens are
    // out of spotting range, so they walk to their posts instead of duelling
    // the camera at their spawn. Then the player steps up to Mid, where the
    // defender holding the lane fills the frame.
    giveLoadout(player, 'rifle');
    state.phase = PHASE.LIVE;
    state.phaseT = ROUND_TIME;
    settle(5);
    player.x = 0;
    player.z = -2;
    render.clearFx();
    const enemy = nearestVisibleEnemy();
    if (enemy) {
      aimAt(player, enemy.x, enemy.y + 1.3, enemy.z);
      fireWeapon(state, player, 0.002, 0);
      applyRecoil(player, 0.004, 0);
      render.muzzle();
      flashT = state.time;
    } else {
      aimAt(player, 0, 1.4, -10);
    }
    settle(0.05);
  }
  for (const a of state.actors) {
    if (a.alive) a.hp = 100;
  }
  drainEvents();
  syncHud();
  let painted = 0;
  function paint() {
    const subject = player;
    render.sync(state, 0, { subject, aiming: false, shake: 0, time: state.time, flashT });
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
      return; // stop scheduling: the frame is set, the page can go idle.
    }
    requestAnimationFrame(paint);
  }
  requestAnimationFrame(paint);
}

window.__game = { state, input, version: 'kestrel-line-1' };
resetMatch();
startRound(1);
if (shot) runShot(shot);
else requestAnimationFrame(frame);
