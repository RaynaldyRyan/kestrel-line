// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. This module owns the round state machine (buy, live, planted,
// over), wires input to the player, drains the sim's events into the HUD, the
// synth and the renderer, and stages the deterministic ?shot= frames the
// screenshots are taken from. The sim itself lives in state, map, physics,
// bots and combat; this file only conducts it.
import { createState, createActor, aliveOf, actorById, pushEvent, TEAM, PHASE, BUY_TIME, ROUND_TIME, PLANT_TIME, FUSE_TIME, ROUNDS_TO_WIN, WIN_REWARD, LOSS_REWARD, START_MONEY } from './state.js';
import { SITES, KESTREL_SPAWN, WARDEN_SPAWN, losBlocked } from './map.js';
import { stepBot, assignBot, canSee } from './bots.js';
import { fireWeapon, startReload, switchWeapon, throwGrenade, buyWeapon, buyGrenade, buyArmor, buyHelmet, buyKit, defuseTime, stepCombat, WEAPONS } from './combat.js';
import { stepPlayer, applyLook, applyRecoil } from './player.js';
import { separate, eyeHeight } from './physics.js';
import { createRender } from './render.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createMinimap } from './minimap.js';

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
const minimap = createMinimap(document.getElementById('minimap'));
const hud = createHud({
  onPlay,
  onBuy: (key) => {
    if (key === 'grenade') buyGrenade(state, 'frag');
    else if (key === 'smoke') buyGrenade(state, 'smoke');
    else if (key === 'flash') buyGrenade(state, 'flash');
    else if (key === 'armor') buyArmor(state);
    else if (key === 'helmet') buyHelmet(state);
    else if (key === 'kit') buyKit(state);
    else if (key === 'pistol') switchWeapon(state, player, 'pistol');
    else buyWeapon(state, key);
    audio.buy();
    refreshBuy();
  },
});
const input = createInput(render.dom, onLockChange);

let player = null;
let playerTeam = TEAM.KESTREL;
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

// Five a side. The player takes the first name of their team; the bots take
// the rest. Kestrel bots split across the lanes, one carrying the charge when
// the player defends; Warden bots take the five hold posts split over both
// sites, and one of them draws the defuse kit each round.
const KESTREL_NAMES = ['Falcon', 'Rook', 'Sable', 'Wren', 'Heron'];
const WARDEN_NAMES = ['Vex', 'Onyx', 'Bram', 'Koda', 'Slate'];
const KESTREL_SPAWNS = [[0, 18], [-2, 19], [2, 19], [-4, 17], [4, 17]];
const WARDEN_SPAWNS = [[0, -19], [-2, -19], [2, -19], [-4, -18], [4, -18]];
const BOT_GUNS = ['rifle', 'rifle', 'smg', 'dmr', 'rifle'];

function setupActors() {
  state.actors.length = 0;
  state.grenades.length = 0;
  state.smokes.length = 0;
  state.noises.length = 0;
  state.events.length = 0;
  const kestrels = [];
  const wardens = [];
  for (let i = 0; i < 5; i += 1) {
    const isPlayer = playerTeam === TEAM.KESTREL && i === 0;
    const a = createActor(
      KESTREL_NAMES[i], TEAM.KESTREL, isPlayer,
      KESTREL_SPAWNS[i][0], KESTREL_SPAWNS[i][1], KESTREL_SPAWN.yaw,
    );
    kestrels.push(a);
    state.actors.push(a);
  }
  for (let i = 0; i < 5; i += 1) {
    const isPlayer = playerTeam === TEAM.WARDEN && i === 0;
    const a = createActor(
      WARDEN_NAMES[i], TEAM.WARDEN, isPlayer,
      WARDEN_SPAWNS[i][0], WARDEN_SPAWNS[i][1], WARDEN_SPAWN.yaw,
    );
    wardens.push(a);
    state.actors.push(a);
  }
  player = state.actors.find((a) => a.isPlayer);
  // The player is always actors[0] for the buy functions: keep the Kestrels
  // first and move the player to the front when they defend.
  if (playerTeam === TEAM.WARDEN) {
    state.actors.splice(state.actors.indexOf(player), 1);
    state.actors.unshift(player);
  }
  // Kestrel bots: assault the lanes; when the player defends, one of them
  // carries the charge to a site picked for the round.
  const carrierToB = state.rng() < 0.5;
  const kBots = kestrels.filter((a) => !a.isPlayer);
  const routes = playerTeam === TEAM.KESTREL
    ? ['west', 'east', 'mid', 'westB']
    : ['west', 'east', 'mid', 'west'];
  kBots.forEach((a, i) => {
    if (playerTeam === TEAM.WARDEN && i === 0) {
      assignBot(a, 'carrier', carrierToB ? 'westB' : 'mid', undefined, carrierToB ? 'B' : 'A');
    } else {
      assignBot(a, 'assault', routes[i] || 'mid');
    }
    giveLoadout(a, BOT_GUNS[i]);
  });
  // Warden bots take the hold posts; one draws the defuse kit.
  const wBots = wardens.filter((a) => !a.isPlayer);
  wBots.forEach((a, i) => {
    assignBot(a, 'hold', null, i);
    giveLoadout(a, BOT_GUNS[i]);
  });
  if (wBots.length > 0) wBots[Math.floor(state.rng() * wBots.length)].kit = true;
  return player;
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
  // The player keeps bought weapons and spare grenades across rounds; ammo is
  // refilled, but armour, helmets and kits are spent when the round ends.
  const keep = player ? {
    owned: player.owned, weapon: player.weapon, stash: player.stash,
    grenades: player.grenades, smoke: player.smoke, flashes: player.flashes,
  } : null;
  setupActors();
  if (keep) Object.assign(player, keep);
  const def = WEAPONS[player.weapon];
  player.mag = def.mag;
  player.reserve = def.reserve;
  player.armor = false;
  player.helmet = false;
  player.kit = false;
  // The charge rides with the player when they attack, with the carrier bot
  // when they defend.
  const carrier = playerTeam === TEAM.KESTREL
    ? player
    : state.actors.find((a) => a.bot && a.bot.role === 'carrier');
  state.bomb = { mode: 'carried', carrier: carrier.id, site: null, x: carrier.x, z: carrier.z, fuse: 0, planter: null, defuser: null, plantP: 0, defuseP: 0 };
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
  const playerWon = winner === playerTeam;
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

function onPlay(team) {
  // The start screen passes the chosen team; a pause resume passes nothing and
  // keeps the current side. Switching sides restarts round 1 with the new
  // rosters; the boot round is already Kestrel, so picking Kestrels needs no
  // restart.
  if (typeof team === 'number' && team !== playerTeam) {
    playerTeam = team;
    resetMatch();
    startRound(1);
  } else if (state.matchOver) {
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
  hud.refreshBuy(state.money, player);
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
  hud.setHealth(player.hp, player.armor, player.helmet, player.kit);
  hud.setGrenades(player.grenades, player.smoke, player.flashes);
  hud.setAlive(aliveOf(state, TEAM.KESTREL), aliveOf(state, TEAM.WARDEN));
  hud.setTeammates(state.actors.filter((a) => a.team === playerTeam));
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
        const weapon = e.weapon ? WEAPONS[e.weapon].name : null;
        hud.killfeed(killer.isPlayer ? 'YOU' : killer.name, victim.isPlayer ? 'YOU' : victim.name, e.head, killer.team, weapon);
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
    } else if (e.type === 'smoke') {
      audio.smoke();
    } else if (e.type === 'flashpop') {
      render.flashPop(e.x, e.y, e.z);
      audio.flash();
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
    // Either site takes the charge; the one the carrier stands in is the one
    // that counts.
    const siteKey = Math.hypot(carrier.x - SITES.A.x, carrier.z - SITES.A.z) < SITES.A.r ? 'A'
      : Math.hypot(carrier.x - SITES.B.x, carrier.z - SITES.B.z) < SITES.B.r ? 'B' : null;
    const wantsPlant = carrier.isPlayer
      ? input.keys.has('KeyE') && carrier.alive
      : carrier.channelKind === 'plant';
    if (siteKey && wantsPlant && state.phase === PHASE.LIVE) {
      bomb.planter = carrier.id;
      bomb.plantP += dt / PLANT_TIME;
      carrier.channel = bomb.plantP;
      if (bomb.plantP >= 1) {
        bomb.mode = 'planted';
        bomb.site = siteKey;
        bomb.fuse = FUSE_TIME;
        bomb.carrier = null;
        bomb.planter = null;
        carrier.channel = 0;
        carrier.channelKind = null;
        state.phase = PHASE.PLANTED;
        state.phaseT = FUSE_TIME;
        hud.banner(
          `CHARGE PLANTED — SITE ${siteKey}`,
          playerTeam === TEAM.KESTREL ? `Defend Site ${siteKey} until it detonates` : `The charge is at Site ${siteKey} — take it apart`,
          3000,
        );
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
        if (a.isPlayer) hud.hint('You picked up the charge — take it to Site A or B', 3000);
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
    // The defuse radius is the site radius (both sites are 4 m); a kit halves
    // the channel time.
    const R = SITES.A.r;
    // A defending player channels by holding E next to the charge.
    if (player.team === TEAM.WARDEN && player.alive) {
      player.channelKind = input.keys.has('KeyE')
        && Math.hypot(player.x - bomb.x, player.z - bomb.z) < R ? 'defuse' : null;
    }
    let defuser = bomb.defuser ? actorById(state, bomb.defuser) : null;
    if (defuser && (!defuser.alive || defuser.channelKind !== 'defuse'
        || Math.hypot(defuser.x - bomb.x, defuser.z - bomb.z) >= R)) {
      defuser.channel = 0;
      defuser.channelKind = null;
      bomb.defuser = null;
      defuser = null;
    }
    if (!defuser) {
      for (const a of state.actors) {
        if (!a.alive || a.team !== TEAM.WARDEN) continue;
        if (a.channelKind === 'defuse' && Math.hypot(a.x - bomb.x, a.z - bomb.z) < R) {
          bomb.defuser = a.id;
          defuser = a;
          break;
        }
      }
    }
    if (defuser) {
      bomb.defuseP += dt / defuseTime(defuser);
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
      hud.hint(
        playerTeam === TEAM.KESTREL ? 'Go — plant the charge at Site A or B' : 'Hold the sites — stop the plant',
        3000,
      );
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
    const buys = { Digit1: 'rifle', Digit2: 'smg', Digit3: 'dmr', Digit4: 'grenade', Digit5: 'smoke', Digit6: 'flash', Digit7: 'armor', Digit8: 'helmet', Digit9: 'kit' };
    for (const code of Object.keys(buys)) {
      if (input.takePressed(code)) {
        const key = buys[code];
        if (key === 'grenade') buyGrenade(state, 'frag');
        else if (key === 'smoke') buyGrenade(state, 'smoke');
        else if (key === 'flash') buyGrenade(state, 'flash');
        else if (key === 'armor') buyArmor(state);
        else if (key === 'helmet') buyHelmet(state);
        else if (key === 'kit') buyKit(state);
        else buyWeapon(state, key);
        audio.buy();
        refreshBuy();
      }
    }
    if (input.takePressed('Escape')) closeBuy();
    return;
  }
  if (input.takePressed('KeyR')) startReload(state, player);
  // 3 frag, 4 flash, 5 smoke; G still throws a frag.
  if (input.takePressed('KeyG') || input.takePressed('Digit3')) {
    if (throwGrenade(state, player, 'frag')) hud.setGrenades(player.grenades, player.smoke, player.flashes);
  }
  if (input.takePressed('Digit4')) {
    if (throwGrenade(state, player, 'flash')) hud.setGrenades(player.grenades, player.smoke, player.flashes);
  }
  if (input.takePressed('Digit5')) {
    if (throwGrenade(state, player, 'smoke')) hud.setGrenades(player.grenades, player.smoke, player.flashes);
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
    hud.setBomb(`BOMB PLANTED — SITE ${state.bomb.site} — ${formatTime(state.bomb.fuse)}`, state.bomb.fuse / FUSE_TIME);
  } else if (state.bomb.mode === 'carried' && state.bomb.carrier === player.id) {
    hud.setBomb('YOU CARRY THE CHARGE — E TO PLANT AT SITE A OR B', 1);
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
      spectateTarget = state.actors.find((a) => a.team === playerTeam && a.alive && !a.isPlayer) || null;
      hud.setSpectating(spectateTarget ? spectateTarget.name : null);
    }
  }
  // Radar: enemies show only while the player can see them right now.
  const seen = new Set();
  for (const a of state.actors) {
    if (a.team !== playerTeam && a.alive && canSee(state, player, a)) seen.add(a.id);
  }
  minimap.draw(state, player, seen);
  // A flash whites the screen in proportion to the blindness left.
  hud.setFlash(player.blindT > 0 ? Math.min(1, player.blindT / 1.2) : 0);
  // The scoreboard refreshes whenever it is open.
  if (input.keys.has('Tab')) {
    hud.setScores(state.actors.map((a) => ({
      name: a.isPlayer ? 'YOU' : a.name,
      team: a.team,
      alive: a.alive,
      kills: a.kills,
      deaths: a.deaths,
      money: a.isPlayer ? `$${state.money}` : '—',
    })));
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
    hud.showScores(input.keys.has('Tab'));
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
    if (a.team === playerTeam || !a.alive) continue;
    const d = Math.hypot(a.x - player.x, a.z - player.z);
    const chestY = a.y + eyeHeight(a) - 0.25;
    if (losBlocked(player.x, eyeY, player.z, a.x, chestY, a.z)) continue;
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

function runShot(name) {
  // The menu shot keeps the start overlay up: the team choice and the feature
  // list are the picture. Every other shot hides it.
  if (name === 'menu') {
    hud.hideBanner();
    settle(0.5);
    drainEvents();
    syncHud();
    let painted = 0;
    function paintMenu() {
      render.sync(state, 0, { subject: player, aiming: false, shake: 0, time: state.time, flashT });
      painted += 1;
      if (painted === 2) {
        window.__shotReady = true;
        frozen = true;
        return;
      }
      requestAnimationFrame(paintMenu);
    }
    requestAnimationFrame(paintMenu);
    return;
  }
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
  } else if (name === 'siteb') {
    // Charge planted at Site B; the player covers it from the east while a
    // Warden closes in to defuse.
    giveLoadout(player, 'rifle');
    state.phase = PHASE.LIVE;
    state.phaseT = ROUND_TIME;
    player.x = -16;
    player.z = -10;
    state.bomb.mode = 'planted';
    state.bomb.site = 'B';
    state.bomb.carrier = null;
    state.bomb.x = -22;
    state.bomb.z = -16;
    state.bomb.fuse = 28;
    state.phase = PHASE.PLANTED;
    state.phaseT = 28;
    settle(2.5);
    render.clearFx();
    aimAt(player, -22, 0.6, -16);
    hud.banner('CHARGE PLANTED — SITE B', 'Defend Site B until it detonates');
  } else {
    // Cover: mid-combat on Mid, rifle out, a Warden in the sights, a smoke
    // cloud hanging over the lane's west side. The player waits at the spawn
    // while the scene settles — from there the Wardens are out of spotting
    // range, so they walk to their posts instead of duelling the camera at
    // their spawn. Then the player steps up to Mid, throws the smoke, and
    // opens fire on the defender holding the lane.
    giveLoadout(player, 'rifle');
    player.smoke = 1;
    state.phase = PHASE.LIVE;
    state.phaseT = ROUND_TIME;
    settle(5);
    player.x = 0;
    player.z = -2;
    render.clearFx();
    // The smoke lands centre-left, a few metres up the lane; the defender at
    // Site A stays visible to its right.
    aimAt(player, -1.5, 1.0, -7);
    throwGrenade(state, player, 'smoke');
    settle(1.4);
    render.clearFx();
    // The tracer comes from a bot, not the player: a shot fired down the
    // player's own view axis foreshortens to a dot, but a teammate firing
    // from the lane's west side at the Site A defender cuts a diagonal across
    // the frame. The shooter stands where a real push would put it — just
    // west of Mid, closing on the site. The player holds fire so the muzzle
    // flash does not cover the defender.
    const enemy = nearestVisibleEnemy();
    const shooter = state.actors
      .filter((a) => a.team === TEAM.KESTREL && !a.isPlayer && a.alive)
      .sort((a, b) => a.x - b.x)[0];
    if (shooter && enemy) {
      shooter.x = -4.5;
      shooter.z = -9.5;
      for (let i = 0; i < 2; i += 1) {
        aimAt(shooter, enemy.x, enemy.y + 1.3, enemy.z);
        fireWeapon(state, shooter, 0.005, 0);
        settle(0.12);
      }
    }
    if (enemy) aimAt(player, enemy.x, enemy.y + 1.3, enemy.z);
    else aimAt(player, 0, 1.4, -10);
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

window.__game = { state, input, version: 'kestrel-line-2' };
resetMatch();
startRound(1);
if (shot) runShot(shot);
else requestAnimationFrame(frame);
