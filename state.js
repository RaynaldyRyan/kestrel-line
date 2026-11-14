// One state object for the whole match. The simulation (map, bots, combat, player)
// reads and writes only this; rendering and the HUD only read it. No three.js here:
// positions are plain numbers, so the sim stays testable and apart from the scene.
export const TEAM = { KESTREL: 0, WARDEN: 1 };
export const TEAM_NAME = ['Kestrels', 'Wardens'];
export const PHASE = { BUY: 'buy', LIVE: 'live', PLANTED: 'planted', OVER: 'over' };

export const BUY_TIME = 12;
export const ROUND_TIME = 100;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const FUSE_TIME = 35;
export const ROUNDS_TO_WIN = 5;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const START_MONEY = 800;

export function mulberry32(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextActorId = 1;

export function createActor(name, team, isPlayer, x, z, yaw) {
  return {
    id: nextActorId++,
    name,
    team,
    isPlayer,
    alive: true,
    hp: 100,
    armor: false,
    x, y: 0, z,
    vx: 0, vy: 0, vz: 0,
    yaw, pitch: 0,
    crouch: false,
    onGround: true,
    weapon: 'pistol',
    owned: { pistol: true, smg: false, rifle: false, dmr: false },
    mag: 12,
    reserve: 48,
    grenades: 0,
    reloadT: 0,
    cooldown: 0,
    channel: 0, // plant/defuse progress 0..1, 0 when not channelling
    channelKind: null, // 'plant' | 'defuse'
    deadT: 0,
    bot: null,
    // Render-only scratch, written by render.js, never read by the sim.
    flash: 0,
    lastDamageFrom: -1,
  };
}

export function createState(seed) {
  return {
    rng: mulberry32(seed),
    time: 0,
    phase: PHASE.BUY,
    phaseT: BUY_TIME,
    round: 1,
    wins: [0, 0],
    matchOver: false,
    matchWinner: -1,
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    roundKills: 0,
    bomb: {
      mode: 'carried', // carried | dropped | planted | gone
      carrier: 1, // actor id, or null
      x: 0, z: 0,
      fuse: 0,
      planter: null,
      defuser: null,
      plantP: 0, // plant progress 0..1, shared across hands
      defuseP: 0, // defuse progress 0..1, shared across Wardens
    },
    actors: [],
    grenades: [], // { x, y, z, vx, vy, vz, fuse, owner }
    events: [], // drained once a frame by the HUD and the audio synth
    noises: [], // { x, z, t } gunshots bots can hear
    overReason: '',
    overT: 0,
  };
}

export function aliveOf(state, team) {
  let count = 0;
  for (const a of state.actors) if (a.alive && a.team === team) count += 1;
  return count;
}

export function actorById(state, id) {
  for (const a of state.actors) if (a.id === id) return a;
  return null;
}

export function pushEvent(state, event) {
  state.events.push(event);
  if (state.events.length > 64) state.events.splice(0, state.events.length - 64);
}
