// Keyboard, mouse and touch input. Emits turns; reports whether boost is held.
// Turns go to the game loop, which feeds the simulation one per tick (the sim keeps a 2-turn buffer).

const KEY_DIR: Record<string, number> = {
  ArrowUp: 0, w: 0, W: 0, ArrowRight: 1, d: 1, D: 1,
  ArrowDown: 2, s: 2, S: 2, ArrowLeft: 3, a: 3, A: 3,
};
const SWIPE_MIN = 24; // px, so a tap never turns the snake
const HOLD_MS = 300; // stationary hold to boost on touch
const DOUBLE_TAP_MS = 300;

export function attachInput(el: HTMLElement, onTurn: (d: number) => void) {
  let space = false, touchBoost = false;
  let sx = 0, sy = 0, down = false, swiped = false, lastTapEnd = -1e9;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key in KEY_DIR) { e.preventDefault(); if (!e.repeat) onTurn(KEY_DIR[e.key]); }
    else if (e.code === 'Space') { e.preventDefault(); space = true; }
  };
  const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') space = false; };

  const onDown = (e: PointerEvent) => {
    down = true; swiped = false; sx = e.clientX; sy = e.clientY;
    el.setPointerCapture(e.pointerId);
    if (e.pointerType === 'mouse') return; // mouse: swipes only, boost is space
    if (e.timeStamp - lastTapEnd < DOUBLE_TAP_MS) touchBoost = true; // double-tap and hold
    else holdTimer = setTimeout(() => { if (!swiped) touchBoost = true; }, HOLD_MS);
  };
  const onMove = (e: PointerEvent) => {
    if (!down) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.hypot(dx, dy) < SWIPE_MIN) return;
    onTurn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
    sx = e.clientX; sy = e.clientY; swiped = true; // chain swipes without lifting
    clearTimeout(holdTimer);
  };
  const onUp = (e: PointerEvent) => {
    down = false; touchBoost = false; clearTimeout(holdTimer);
    lastTapEnd = swiped ? -1e9 : e.timeStamp;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  return {
    isBoosting: () => space || touchBoost,
    detach() {
      clearTimeout(holdTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    },
  };
}
