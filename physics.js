// Body physics, shared by the player and the bots: acceleration toward a wish
// direction, friction on the ground, gravity, and a box resolved against the
// map's colliders one axis at a time, so a wall never swallows a body. Crouching
// halves the height and the speed; standing up again is refused while a ceiling
// is in the way.
import { BOUNDS, COLLIDERS } from './map.js';

export const RADIUS = 0.34;
export const STAND_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.12;
export const EYE_STAND = 1.6;
export const EYE_CROUCH = 1.02;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.5;
const GROUND_ACCEL = 40;
const AIR_ACCEL = 8;
const FRICTION = 9;
const GRAVITY = 20;
export const JUMP_SPEED = 6.4;

function overlaps(x, y, z, height, lift) {
  const minX = x - RADIUS;
  const maxX = x + RADIUS;
  const minY = y + lift;
  const maxY = y + height - lift;
  const minZ = z - RADIUS;
  const maxZ = z + RADIUS;
  for (const c of COLLIDERS) {
    if (maxX > c.minX && minX < c.maxX && maxY > c.minY && minY < c.maxY && maxZ > c.minZ && minZ < c.maxZ) return c;
  }
  return null;
}

export function eyeHeight(actor) {
  return actor.crouch ? EYE_CROUCH : EYE_STAND;
}

export function bodyHeight(actor) {
  return actor.crouch ? CROUCH_HEIGHT : STAND_HEIGHT;
}

// wishX/wishZ is a unit (or zero) direction on the ground plane; speed scales it.
// Returns the ground speed after the step, which the gunplay reads for spread.
export function stepBody(actor, dt, wishX, wishZ, speedScale, jump) {
  const speed = (actor.crouch ? CROUCH_SPEED : WALK_SPEED) * speedScale;
  const blend = Math.min(1, ((actor.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt) / Math.max(speed, 0.01));
  actor.vx += (wishX * speed - actor.vx) * blend;
  actor.vz += (wishZ * speed - actor.vz) * blend;
  if (actor.onGround && wishX === 0 && wishZ === 0) {
    const damp = Math.max(0, 1 - FRICTION * dt);
    actor.vx *= damp;
    actor.vz *= damp;
  }
  if (jump && actor.onGround) {
    actor.vy = JUMP_SPEED;
    actor.onGround = false;
  }
  actor.vy -= GRAVITY * dt;
  actor.vy = Math.max(-30, actor.vy);

  const height = bodyHeight(actor);
  const nextX = actor.x + actor.vx * dt;
  if (nextX > BOUNDS.minX + RADIUS && nextX < BOUNDS.maxX - RADIUS
      && !overlaps(nextX, actor.y, actor.z, height, 0.04)) {
    actor.x = nextX;
  } else {
    actor.vx = 0;
  }
  const nextZ = actor.z + actor.vz * dt;
  if (nextZ > BOUNDS.minZ + RADIUS && nextZ < BOUNDS.maxZ - RADIUS
      && !overlaps(actor.x, actor.y, nextZ, height, 0.04)) {
    actor.z = nextZ;
  } else {
    actor.vz = 0;
  }

  actor.y += actor.vy * dt;
  actor.onGround = false;
  const hit = overlaps(actor.x, actor.y, actor.z, height, 0);
  if (hit && actor.vy <= 0) {
    actor.y = hit.maxY;
    actor.vy = 0;
    actor.onGround = true;
  } else if (hit) {
    actor.y = hit.minY - height;
    actor.vy = 0;
  }
  if (actor.y < 0) {
    actor.y = 0;
    actor.vy = 0;
    actor.onGround = true;
  }
  return Math.hypot(actor.vx, actor.vz);
}

export function setCrouch(actor, want) {
  if (want && !actor.crouch) {
    actor.crouch = true;
  } else if (!want && actor.crouch
      && !overlaps(actor.x, actor.y, actor.z, STAND_HEIGHT, 0.02)) {
    actor.crouch = false;
  }
}

// Gentle separation so actors never stand inside each other. Runs after the
// per-actor steps, over alive actors only.
export function separate(actors) {
  for (let i = 0; i < actors.length; i += 1) {
    const a = actors[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < actors.length; j += 1) {
      const b = actors[j];
      if (!b.alive) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 0.0001 && d2 < 0.64) {
        const d = Math.sqrt(d2);
        const push = (0.8 - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
      }
    }
  }
}
