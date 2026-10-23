// Canvas renderer. Reads sim state, never mutates it. Interpolates between sim moves for smooth motion.
import type { Food, State, Tile } from '../sim/sim.ts';
import { FIREFLY_TTL, TPS } from '../sim/sim.ts';
import type { Fx } from './fx';
import { C, PATTERNS, PLAYER_SKIN, skin } from './skins';

export interface Layout { w: number; h: number; ts: number; ox: number; oy: number; cols: number; rows: number }
export interface View { angle: number; floorTs: number; floor: CanvasPattern | null; haz: CanvasPattern | null; grain: CanvasPattern | null; cache: HTMLCanvasElement[] }

const HUD_TOP = (w: number) => (w < 600 ? 60 : 72);
const HUD_BOTTOM = 76;
const RING = 0.8; // hazard ring width in tiles
const ANGLE = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

/** Pick a grid that suits the viewport, so phones get a tall arena and desktops a wide one. */
export function pickGrid(w: number, h: number) {
  const t = w < 600 ? 22 : 34;
  const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
  return {
    cols: clamp(Math.floor(w / t) - 2, 14, 44),
    rows: clamp(Math.floor((h - HUD_TOP(w) - HUD_BOTTOM) / t) - 2, 14, 32),
  };
}

export function layout(w: number, h: number, cols: number, rows: number): Layout {
  const top = HUD_TOP(w), availH = h - top - HUD_BOTTOM;
  const ts = Math.max(8, Math.floor(Math.min(w / (cols + 2 * RING), availH / (rows + 2 * RING))));
  return { w, h, ts, cols, rows, ox: Math.round((w - cols * ts) / 2), oy: Math.round(top + (availH - rows * ts) / 2) };
}

export const makeView = (): View => ({ angle: 0, floorTs: 0, floor: null, haz: null, grain: null, cache: [] });

const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function buildPatterns(ctx: CanvasRenderingContext2D, v: View, ts: number) {
  // floor: 2x2 rounded tiles in four shades with halftone dots, as in the arena design
  const f = mk(ts * 2, ts * 2), g = f.getContext('2d')!;
  g.fillStyle = C.jungle; g.fillRect(0, 0, ts * 2, ts * 2);
  const shades = ['#12221A', '#101E16', '#101E16', '#132319'];
  shades.forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath(); g.roundRect((i % 2) * ts + ts * 0.05, ((i / 2) | 0) * ts + ts * 0.05, ts * 0.9, ts * 0.9, ts * 0.12); g.fill();
  });
  g.fillStyle = '#1B3226';
  for (const [x, y, rr] of [[0.35, 0.3, 0.06], [1.5, 0.62, 0.05], [0.62, 1.4, 0.06], [1.62, 1.62, 0.055]]) {
    g.beginPath(); g.arc(x * ts, y * ts, rr * ts, 0, 7); g.fill();
  }
  v.floor = ctx.createPattern(f, 'repeat');
  // hazard: red and black diagonal stripes
  const hz = ts * 1.4, h = mk(hz, hz), hg = h.getContext('2d')!;
  hg.fillStyle = C.void; hg.fillRect(0, 0, hz, hz);
  hg.fillStyle = '#5A1208'; hg.fillRect(0, 0, hz / 2, hz);
  v.haz = ctx.createPattern(h, 'repeat');
  v.haz?.setTransform(new DOMMatrix().rotate(45));
  // grain: faint white noise
  if (!v.grain) {
    const n = mk(128, 128), ng = n.getContext('2d')!, img = ng.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) { img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.random() * 255; }
    ng.putImageData(img, 0, 0);
    v.grain = ctx.createPattern(n, 'repeat');
  }
  v.floorTs = ts;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutBack = (t: number) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

function drawFood(ctx: CanvasRenderingContext2D, f: Food, s: State, ts: number, now: number, tickF: number) {
  const age = Math.min(1, (tickF - f.born) / (TPS / 4));
  const pop = age < 1 ? easeOutBack(Math.max(0, age)) : 1;
  const bob = Math.sin(now * 3 + f.id) * 0.04 * ts;
  const k = ts / 42;
  ctx.save();
  ctx.translate((f.x + 0.5) * ts, (f.y + 0.5) * ts + bob);
  ctx.scale(pop, pop);
  if (f.kind === 'berry') {
    ctx.scale(k * 1.5, k * 1.5);
    ctx.fillStyle = 'rgba(5,8,5,.4)'; circle(ctx, 3, 5, 13);
    ctx.lineWidth = 3; ctx.strokeStyle = C.void; ctx.fillStyle = '#C21F73'; circle(ctx, 0, 0, 13, true);
    ctx.fillStyle = '#FF4FA0'; circle(ctx, -1.5, -2, 10.5);
    ctx.fillStyle = '#FFB3D6'; circle(ctx, -4, -6, 3);
    ctx.fillStyle = C.limeShade; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(1, -12); ctx.bezierCurveTo(5, -21, 14, -20, 15, -18); ctx.bezierCurveTo(12, -13, 7, -11, 1, -12); ctx.fill(); ctx.stroke();
  } else if (f.kind === 'beetle') {
    ctx.rotate((((f.id * 47) % 60) - 30) * Math.PI / 180);
    ctx.scale(k * 1.5, k * 1.5);
    ctx.fillStyle = 'rgba(5,8,5,.4)'; ctx.beginPath(); ctx.ellipse(2, 4, 11, 14, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = C.void; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); for (const [a, b, c, d] of [[-9, -3, -18, -8], [-10, 4, -19, 6], [-9, 10, -17, 16], [9, -3, 18, -8], [10, 4, 19, 6], [9, 10, 17, 16]]) { ctx.moveTo(a, b); ctx.lineTo(c, d); } ctx.stroke();
    ctx.lineWidth = 3; ctx.fillStyle = '#C25A00'; ctx.beginPath(); ctx.ellipse(0, 0, 11, 14, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#FF8A1F'; ctx.beginPath(); ctx.ellipse(-1.5, -1.5, 8.5, 11.5, 0, 0, 7); ctx.fill();
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(0, 14); ctx.stroke();
    ctx.fillStyle = C.void; circle(ctx, 0, -16, 5.5);
  } else if (f.kind === 'firefly') {
    const left = FIREFLY_TTL - (tickF - f.born);
    if (left < 3 * TPS && Math.floor(now * 8) % 2) { ctx.restore(); return; } // blink out
    ctx.scale(k * 1.5, k * 1.5);
    const pulse = 1 + Math.sin(now * 5 + f.id) * 0.07;
    ctx.fillStyle = C.gold;
    ctx.globalAlpha = 0.1; circle(ctx, 0, 0, 30 * pulse); // stepped flat rings, no blur
    ctx.globalAlpha = 0.16; circle(ctx, 0, 0, 22 * pulse);
    ctx.globalAlpha = 0.24; circle(ctx, 0, 0, 15 * pulse);
    ctx.globalAlpha = 1;
    const flap = 35 + Math.sin(now * 30 + f.id) * 12;
    ctx.fillStyle = C.bone; ctx.strokeStyle = C.void; ctx.lineWidth = 2;
    for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sgn * 9, -4, 9.5, 5, sgn * flap * Math.PI / 180, 0, 7); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = C.gold; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(0, 0, 5, 8.5, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#FFF59A'; circle(ctx, 0, 5, 3.5);
  } else {
    // bead, in the player's colour
    const sk = skin(PLAYER_SKIN);
    ctx.scale(ts / 27, ts / 27);
    ctx.fillStyle = 'rgba(5,8,5,.4)'; circle(ctx, 3, 4, 9);
    ctx.lineWidth = 3; ctx.strokeStyle = C.void; ctx.fillStyle = sk.pattern; circle(ctx, 0, 0, 9, true);
    ctx.fillStyle = sk.base; circle(ctx, -1, -1.5, 6.8);
    ctx.fillStyle = sk.highlight; circle(ctx, -3, -4, 2.2);
  }
  ctx.restore();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stroke = false) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); if (stroke) ctx.stroke();
}

function bodyPath(pts: Tile[], dx = 0, dy = 0): Path2D {
  const p = new Path2D();
  p.moveTo(pts[0].x + dx, pts[0].y + dy);
  for (let i = 1; i < pts.length - 1; i++) // quadratic through midpoints rounds the 90 degree corners
    p.quadraticCurveTo(pts[i].x + dx, pts[i].y + dy, (pts[i].x + pts[i + 1].x) / 2 + dx, (pts[i].y + pts[i + 1].y) / 2 + dy);
  const l = pts[pts.length - 1];
  p.lineTo(l.x + dx, l.y + dy);
  return p;
}

function drawSnake(ctx: CanvasRenderingContext2D, pts: Tile[], ts: number, travel: number, v: View, fx: Fx, now: number) {
  const sk = skin(PLAYER_SKIN), pat = PATTERNS[PLAYER_SKIN];
  const ow = ts * 0.92, u = ow / 56;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
  const stroke = (color: string, width: number, dx = 0, dy = 0) => { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(bodyPath(pts, dx, dy)); };

  ctx.globalAlpha = 0.45; stroke(C.void, ow, ow * 0.14, ow * 0.21); ctx.globalAlpha = 1; // 1 floor shadow
  stroke(C.void, ow); // 2 outline
  stroke(sk.shade, ow * 0.82); // 3 shade
  stroke(sk.base, ow * 0.68, -ow * 0.036, -ow * 0.07); // 4 base, nudged up-left
  // 5 pattern, anchored to the body so it doesn't crawl as the head moves
  ctx.setLineDash([Math.max(0.01, pat.dash[0] * ow), pat.dash[1] * ow]);
  ctx.lineDashOffset = -travel; ctx.lineCap = pat.cap; ctx.globalAlpha = pat.alpha;
  stroke(sk.pattern, ow * pat.width);
  ctx.globalAlpha = 1; ctx.lineCap = 'round';
  ctx.setLineDash([ow * 0.43, ow * 0.61]); ctx.lineDashOffset = -travel; // 6 highlight dashes
  stroke(sk.highlight, ow * 0.09, -ow * 0.07, -ow * 0.21);
  ctx.setLineDash([]);

  // gulp: a bulge travels down the body after eating
  if (!fx.reduced && fx.eatT < 0.6 && pts.length > 2) {
    const f = (fx.eatT / 0.6) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), t = f - i;
    const bx = lerp(pts[i].x, pts[i + 1].x, t), by = lerp(pts[i].y, pts[i + 1].y, t), R = (ow / 2) * 1.16;
    ctx.fillStyle = C.void; circle(ctx, bx, by, R);
    ctx.fillStyle = sk.shade; circle(ctx, bx, by, R * 0.82);
    ctx.fillStyle = sk.base; circle(ctx, bx - ow * 0.036, by - ow * 0.07, R * 0.68);
  }

  // head: rotates to face travel, squashes on eating, red tongue flicks
  const squash = fx.reduced ? 0 : Math.max(0, 1 - fx.eatT / 0.22);
  ctx.save();
  ctx.translate(pts[0].x, pts[0].y);
  ctx.rotate(v.angle);
  ctx.scale(u * (1 + 0.3 * squash), u * (1 - 0.18 * squash));
  const ph = (now % 2.4) / 0.5, flick = fx.eatT < 0.3 ? 1 : ph < 1 ? Math.sin(ph * Math.PI) : 0;
  if (flick > 0.05) {
    const e = 36 + 26 * flick;
    ctx.strokeStyle = C.red; ctx.lineWidth = 5; ctx.beginPath();
    ctx.moveTo(36, 0); ctx.lineTo(e, 0);
    ctx.moveTo(e, 0); ctx.lineTo(e + 12 * flick, -9 * flick);
    ctx.moveTo(e, 0); ctx.lineTo(e + 12 * flick, 9 * flick);
    ctx.stroke();
  }
  ctx.fillStyle = C.void; ctx.beginPath(); ctx.ellipse(0, 0, 40, 34, 0, 0, 7); ctx.fill();
  ctx.fillStyle = sk.shade; ctx.beginPath(); ctx.ellipse(0, 0, 35, 29, 0, 0, 7); ctx.fill();
  ctx.fillStyle = sk.base; ctx.beginPath(); ctx.ellipse(-2, -3, 32, 26, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = sk.highlight; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-18, -20); ctx.bezierCurveTo(-8, -26, 6, -26, 14, -20); ctx.stroke();
  for (const sy of [-14, 14]) {
    ctx.fillStyle = C.bone; ctx.strokeStyle = C.void; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.ellipse(8, sy, 10, 11, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.void; circle(ctx, 12, sy, 5);
    ctx.fillStyle = C.bone; circle(ctx, 14, sy - 2, 1.8);
  }
  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, fx: Fx, ts: number) {
  for (const p of fx.parts) {
    const t = p.life / p.max, x = p.x * ts, y = p.y * ts, sz = p.size * ts;
    ctx.save();
    ctx.globalAlpha = p.k === 'shard' || p.k === 'text' ? Math.min(1, (1 - t) * 2.2) : 1 - t * t;
    ctx.translate(x, y);
    if (p.k === 'dot') { ctx.fillStyle = p.color; ctx.strokeStyle = C.void; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, sz * (1 - t * 0.4), 0, 7); ctx.fill(); ctx.stroke(); }
    else if (p.k === 'shard') {
      ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.strokeStyle = C.void; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(-sz, sz * 0.7); ctx.lineTo(sz * 0.2, -sz); ctx.lineTo(sz, sz * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (p.k === 'coin') {
      ctx.scale(Math.abs(Math.cos(p.rot)) * 0.8 + 0.2, 1); // spinning
      ctx.fillStyle = C.gold; ctx.strokeStyle = C.void; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, sz, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.goldShadow; ctx.beginPath(); ctx.arc(0, 0, sz * 0.5, 0, 7); ctx.fill();
    } else {
      ctx.font = `${Math.round(sz * 1.6)}px Bungee, 'Arial Black', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = C.void; ctx.strokeText(p.text ?? "", 0, 0);
      ctx.fillStyle = p.color; ctx.fillText(p.text ?? "", 0, 0);
    }
    ctx.restore();
  }
}

export function render(ctx: CanvasRenderingContext2D, L: Layout, v: View, s: State, prev: Tile[], prevDir: number, alpha: number, fx: Fx, dt: number, now: number) {
  const { w, h, ts, ox, oy, cols, rows } = L;
  if (v.floorTs !== ts) buildPatterns(ctx, v, ts);
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  ctx.fillStyle = C.jungle; ctx.fillRect(0, 0, w, h);

  ctx.save();
  if (fx.shake > 0 && !fx.reduced) ctx.translate((Math.random() - 0.5) * 12 * fx.shake * fx.shake, (Math.random() - 0.5) * 12 * fx.shake * fx.shake);

  // floor, aligned to the arena origin
  ctx.save(); ctx.translate(ox, oy);
  ctx.fillStyle = v.floor ?? C.moss; ctx.fillRect(-ox - ts * 2, -oy - ts * 2, w + ts * 4, h + ts * 4);

  const tickF = s.tick + alpha;
  const span = Math.max(1, s.nextMove - s.lastMove);
  const p = s.alive ? Math.min(1, Math.max(0, (tickF - s.lastMove) / span)) : 1;
  for (const f of s.food) drawFood(ctx, f, s, ts, now, tickF);

  if (s.alive || fx.deadT < 0) {
    const pts: Tile[] = s.body.map((b, i) => {
      const a = prev[Math.min(i, prev.length - 1)] ?? b;
      return { x: (lerp(a.x, b.x, p) + 0.5) * ts, y: (lerp(a.y, b.y, p) + 0.5) * ts };
    });
    if (pts.length === 1) pts.push({ ...pts[0] });
    // head turns toward the direction of travel by the shortest arc, faster while turning
    const target = ANGLE[s.dir];
    let d = target - v.angle; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    v.angle += d * Math.min(1, dt * 22);
    const travel = (s.moves + p) * ts;
    drawSnake(ctx, pts, ts, travel, v, fx, now);
  }

  drawParticles(ctx, fx, ts);
  ctx.restore();

  // hazard ring around the arena, red dashes on its inner edge
  const rw = ts * RING;
  ctx.save(); ctx.translate(ox, oy);
  ctx.beginPath(); ctx.rect(-rw, -rw, cols * ts + 2 * rw, rows * ts + 2 * rw); ctx.rect(0, 0, cols * ts, rows * ts);
  ctx.fillStyle = v.haz ?? C.void; ctx.fill('evenodd');
  ctx.strokeStyle = C.void; ctx.lineWidth = 4; ctx.strokeRect(-rw, -rw, cols * ts + 2 * rw, rows * ts + 2 * rw);
  ctx.strokeStyle = C.red; ctx.lineWidth = Math.max(2, ts * 0.12); ctx.setLineDash([ts * 0.5, ts * 0.35]);
  ctx.strokeRect(0, 0, cols * ts, rows * ts);
  ctx.setLineDash([]);
  if (fx.flash > 0) { ctx.globalAlpha = 0.5 * fx.flash; ctx.strokeStyle = C.red; ctx.lineWidth = rw; ctx.strokeRect(-rw / 2, -rw / 2, cols * ts + rw, rows * ts + rw); ctx.globalAlpha = 1; }
  ctx.restore();
  ctx.restore();

  // stepped vignette: flat translucent frames, no blur
  ctx.fillStyle = C.void;
  for (const [ix, iy, a] of [[0.055, 0, 0.1], [0.1, 0, 0.1], [0.047, 0.05, 0.08], [0.086, 0.11, 0.1]]) {
    ctx.globalAlpha = a; ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(w * ix, h * iy, w * (1 - 2 * ix), h * (1 - 2 * iy)); ctx.fill('evenodd');
  }
  ctx.globalAlpha = 0.07; ctx.fillStyle = v.grain ?? C.bone; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
}

