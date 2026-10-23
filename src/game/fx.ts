// Visual-only effects. Reads sim events, never writes to the sim. Positions are in tile units.
import type { GameEvent, State } from '../sim/sim.ts';
import { C, skin, PLAYER_SKIN } from './skins';

export interface Particle {
  k: 'dot' | 'shard' | 'coin' | 'text';
  x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; rot: number; vr: number;
  text?: string;
}

export interface Fx {
  reduced: boolean;
  parts: Particle[];
  shake: number; // 0..1, decays
  flash: number; // red wall flash, 0..1
  eatT: number; // seconds since last eat, 99 when idle
  deadT: number; // seconds since death, -1 while alive
  update(dt: number): void;
  onEvents(ev: GameEvent[], s: State): void;
}

const FOOD_COLOR = { berry: '#FF4FA0', beetle: '#FF8A1F', firefly: C.gold, bead: C.lime };
// Visual-only randomness. The sim has its own seeded PRNG and never sees this.
const r = (a: number, b: number) => a + Math.random() * (b - a);

export function createFx(reduced: boolean): Fx {
  const fx: Fx = {
    reduced, parts: [], shake: 0, flash: 0, eatT: 99, deadT: -1,
    update(dt) {
      fx.eatT += dt;
      if (fx.deadT >= 0) fx.deadT += dt;
      fx.shake = Math.max(0, fx.shake - dt * 2.4);
      fx.flash = Math.max(0, fx.flash - dt * 3);
      for (const p of fx.parts) {
        p.life += dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.k === 'shard') p.vy += 22 * dt; // gravity, tiles/s^2
        else if (p.k === 'coin') p.vy += 14 * dt;
      }
      fx.parts = fx.parts.filter((p) => p.life < p.max);
    },
    onEvents(ev, s) {
      const burst = (x: number, y: number, color: string, n: number, speed: number) => {
        if (fx.reduced) return;
        for (let i = 0; i < n; i++) {
          const a = r(0, Math.PI * 2), v = r(0.4, 1) * speed;
          fx.parts.push({ k: 'dot', x: x + 0.5, y: y + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: r(0.25, 0.45), size: r(0.1, 0.18), color, rot: 0, vr: 0 });
        }
      };
      for (const e of ev) {
        if (e.type === 'ate') {
          if (e.kind !== 'bead' && !fx.reduced) fx.eatT = 0;
          burst(e.x, e.y, FOOD_COLOR[e.kind], e.kind === 'firefly' ? 10 : 6, 5);
          if (e.points > 0)
            fx.parts.push({ k: 'text', x: e.x + 0.5, y: e.y - 0.2, vx: 0, vy: fx.reduced ? 0 : -2.4, life: 0, max: 0.8, size: e.kind === 'firefly' ? 1.1 : 0.8, color: e.kind === 'firefly' ? C.gold : C.bone, text: `+${e.points}`, rot: 0, vr: 0 });
          if (e.kind === 'firefly' && !fx.reduced)
            for (let i = 0; i < 4; i++) // coin-pop
              fx.parts.push({ k: 'coin', x: e.x + 0.5, y: e.y + 0.5, vx: r(-3, 3), vy: r(-9, -6), life: 0, max: 0.8, size: 0.34, color: C.gold, rot: 0, vr: r(8, 14) });
        } else if (e.type === 'burn') {
          burst(e.x, e.y, C.lime, 3, 3);
        } else if (e.type === 'died') {
          fx.deadT = 0;
          if (fx.reduced) continue;
          fx.shake = 1;
          if (e.cause === 'wall') fx.flash = 1;
          const sk = skin(PLAYER_SKIN);
          for (const b of s.body)
            for (let i = 0; i < 3; i++) {
              const a = r(0, Math.PI * 2), v = r(3, 9);
              fx.parts.push({ k: 'shard', x: b.x + 0.5, y: b.y + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4, life: 0, max: r(0.7, 1.2), size: r(0.18, 0.34), color: [sk.base, sk.shade, C.void][i], rot: r(0, 6), vr: r(-9, 9) });
            }
        }
      }
    },
  };
  return fx;
}
