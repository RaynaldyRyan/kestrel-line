// The human player: keyboard wish direction into the shared body physics,
// pointer-lock mouse look, and recoil. Shift walks (half speed, steadier aim);
// Space jumps; Ctrl or C crouches. The ground speed it returns feeds the
// weapon spread, so stopping to aim pays.
import { stepBody, setCrouch } from './physics.js';

const SENSITIVITY = 0.0022;

export function applyLook(actor, dx, dy) {
  actor.yaw -= dx * SENSITIVITY;
  actor.pitch = Math.max(-1.45, Math.min(1.45, actor.pitch - dy * SENSITIVITY));
}

export function applyRecoil(actor, pitchKick, yawKick) {
  actor.pitch = Math.min(1.45, actor.pitch + pitchKick);
  actor.yaw += yawKick;
}

export function stepPlayer(actor, keys, dt) {
  setCrouch(actor, keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'));
  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  let wishX = 0;
  let wishZ = 0;
  if (forward !== 0 || strafe !== 0) {
    const sin = Math.sin(actor.yaw);
    const cos = Math.cos(actor.yaw);
    wishX = -sin * forward + cos * strafe;
    wishZ = -cos * forward - sin * strafe;
    const len = Math.hypot(wishX, wishZ) || 1;
    wishX /= len;
    wishZ /= len;
  }
  const walking = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speedScale = walking ? 0.5 : 1;
  const jump = keys.has('Space');
  return stepBody(actor, dt, wishX, wishZ, speedScale, jump);
}
