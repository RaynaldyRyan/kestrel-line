// Keyboard, mouse and pointer lock. Keys live in a Set for held state; the
// pressed queue catches single taps (reload, grenade, buy) exactly once.
// Mouse deltas accumulate while locked and are taken once per frame.
export function createInput(element, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  let lookX = 0;
  let lookY = 0;
  let firing = false;
  let aiming = false;
  let ignoreLookUntil = 0;

  function onKeyDown(event) {
    if (event.code === 'Tab') event.preventDefault();
    if (!event.repeat) pressed.add(event.code);
    keys.add(event.code);
  }
  function onKeyUp(event) {
    keys.delete(event.code);
  }
  function onMouseMove(event) {
    if (document.pointerLockElement !== element) return;
    // Locking the pointer warps the cursor and the browser reports the warp
    // as one huge movement; ignore look input briefly after each lock so the
    // view does not jump. A single real mouse event never carries a delta this
    // large, so a huge one is always a warp or a stale queued event: drop it.
    if (performance.now() < ignoreLookUntil) return;
    if (Math.abs(event.movementX) > 80 || Math.abs(event.movementY) > 80) return;
    lookX += event.movementX;
    lookY += event.movementY;
  }
  function onMouseDown(event) {
    if (document.pointerLockElement !== element) return;
    if (event.button === 0) firing = true;
    if (event.button === 2) aiming = true;
  }
  function onMouseUp(event) {
    if (event.button === 0) firing = false;
    if (event.button === 2) aiming = false;
  }
  function onLock() {
    firing = false;
    aiming = false;
    const locked = document.pointerLockElement === element;
    if (locked) ignoreLookUntil = performance.now() + 120;
    onLockChange(locked);
  }
  function onContextMenu(event) {
    event.preventDefault();
  }
  function onBlur() {
    keys.clear();
    firing = false;
    aiming = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLock);
  element.addEventListener('contextmenu', onContextMenu);

  return {
    keys,
    get firing() { return firing; },
    get aiming() { return aiming; },
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    takePressed(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },
    clearPressed() {
      pressed.clear();
    },
    get locked() {
      return document.pointerLockElement === element;
    },
    requestLock() {
      if (document.pointerLockElement !== element) {
        const p = element.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      }
    },
    exitLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
  };
}
