// BITECLUB simulation. Pure: no DOM, no Math.random, no floats in state.
// A run is (Config, Input[], ticks). The server can replay it with `replay` and recompute the score.
// Erasable TypeScript only (no enums), so `node --test` runs it directly.

export type Dir = 0 | 1 | 2 | 3; // up, right, down, left
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

export const TPS = 60; // fixed tick rate, client and server. 60 so speed can ramp in small steps
export const MIN_LEN = 3; // boost never burns below this
export const BOOST_MIN = 5; // need at least this long to boost
export const BURN_EVERY = 2; // boosted moves per burned tail segment
export const FIREFLY_TTL = 12 * TPS; // ticks
const START_LEN = 3;
const BERRIES = 4;
const BEETLES = 1;
const FIREFLY_ODDS = 10 * TPS; // 1 in N per tick while no firefly is out

export type FoodKind = 'berry' | 'beetle' | 'firefly' | 'bead';
// Points double as growth. Beads (dropped by boost) grow but score 0, so burning and re-eating can't farm score.
export const FOOD_POINTS: Record<FoodKind, number> = { berry: 1, beetle: 2, firefly: 5, bead: 1 };

export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
// Ticks between moves. A run starts at `start`, and every `every` points of score it gets one tick faster, down to `min`.
// At 60 ticks per second: easy runs 4.6 to 8.6 moves/s, medium 5.5 to 12, hard 7.5 to 20.
// Changing these changes how stored runs replay, so runs verified under older numbers no longer match.
const SPEED: Record<Difficulty, { start: number; min: number; every: number }> = {
  easy: { start: 13, min: 7, every: 12 },
  medium: { start: 11, min: 5, every: 8 },
  hard: { start: 8, min: 3, every: 5 },
};

export interface Config { seed: number; cols: number; rows: number; difficulty: Difficulty }
export interface Tile { x: number; y: number }
export interface Food extends Tile { id: number; kind: FoodKind; born: number }
/** Recorded input. `t` is the tick value the step produces. `d` is a turn (-1 for none), `b` the held boost. */
export interface Input { t: number; d: number; b: 0 | 1 }

export type GameEvent =
  | { type: 'moved' }
  | { type: 'ate'; kind: FoodKind; x: number; y: number; points: number }
  | { type: 'burn'; x: number; y: number }
  | { type: 'died'; cause: 'wall' | 'self'; x: number; y: number };

export interface State {
  cfg: Config;
  tick: number;
  rng: number;
  nextId: number;
  body: Tile[]; // head first
  dir: Dir;
  queue: Dir[]; // queued turns, max 2, consumed one per move
  grow: number;
  score: number;
  eaten: number;
  boostMoves: number;
  moves: number; // total moves made, lets the renderer anchor skin patterns to the body
  food: Food[];
  alive: boolean;
  cause: 'wall' | 'self' | null;
  lastMove: number; // tick of the last move
  nextMove: number; // tick of the next move (renderer interpolates between the two)
}

/** Ticks between moves at this score. Boost halves it (never below 2 ticks). Integers only. */
export function moveInterval(s: { cfg: Config; score: number }, boosting: boolean): number {
  const d = SPEED[s.cfg.difficulty];
  const base = Math.max(d.min, d.start - Math.floor(s.score / d.every));
  return boosting ? Math.max(2, Math.ceil(base / 2)) : base;
}
/** 1 at the start of a run, rising as the snake speeds up. */
export const speedLevel = (s: { cfg: Config; score: number }): number => SPEED[s.cfg.difficulty].start - moveInterval(s, false) + 1;
export const maxSpeedLevel = (d: Difficulty): number => SPEED[d].start - SPEED[d].min + 1;
/** Moves per second at the start of a run and at top speed, for display only. */
export const speedRange = (d: Difficulty): { from: number; to: number } => ({ from: TPS / SPEED[d].start, to: TPS / SPEED[d].min });

// mulberry32, integer only
function rnd(s: State, n: number): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = Math.imul(s.rng ^ (s.rng >>> 15), s.rng | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) % n;
}

function occupied(s: State, x: number, y: number): boolean {
  return s.body.some((b) => b.x === x && b.y === y) || s.food.some((f) => f.x === x && f.y === y);
}

function spawn(s: State, kind: FoodKind): void {
  const { cols, rows } = s.cfg;
  for (let i = 0; i < 64; i++) {
    const x = rnd(s, cols), y = rnd(s, rows);
    if (!occupied(s, x, y)) return void s.food.push({ id: s.nextId++, kind, x, y, born: s.tick });
  }
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (!occupied(s, x, y)) return void s.food.push({ id: s.nextId++, kind, x, y, born: s.tick });
}

function topUp(s: State): void {
  const count = (k: FoodKind) => s.food.filter((f) => f.kind === k).length;
  while (count('berry') < BERRIES) spawn(s, 'berry');
  while (count('beetle') < BEETLES) spawn(s, 'beetle');
  if (count('firefly') === 0 && rnd(s, FIREFLY_ODDS) === 0) spawn(s, 'firefly');
}

export function createGame(cfg: Config): State {
  const cx = cfg.cols >> 1, cy = cfg.rows >> 1;
  const s: State = {
    cfg, tick: 0, rng: cfg.seed | 0, nextId: 1,
    body: Array.from({ length: START_LEN }, (_, i) => ({ x: cx - i, y: cy })),
    dir: 1, queue: [], grow: 0, score: 0, eaten: 0, boostMoves: 0, moves: 0,
    food: [], alive: true, cause: null, lastMove: 0, nextMove: 0,
  };
  s.nextMove = moveInterval(s, false);
  topUp(s);
  return s;
}

function enqueue(s: State, turn: number): void {
  const last = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
  // same direction and 180-degree reversals are ignored here, so the server enforces them too
  if (turn < 0 || turn > 3 || turn === last || (turn + 2) % 4 === last || s.queue.length >= 2) return;
  s.queue.push(turn as Dir);
}

function move(s: State, boost: boolean, ev: GameEvent[]): void {
  if (s.queue.length) s.dir = s.queue.shift()!;
  const head = s.body[0];
  const nx = head.x + DX[s.dir], ny = head.y + DY[s.dir];
  // the tail tile is free this move unless we're growing
  const solid = s.grow > 0 ? s.body : s.body.slice(0, -1);
  const wall = nx < 0 || ny < 0 || nx >= s.cfg.cols || ny >= s.cfg.rows;
  if (wall || solid.some((b) => b.x === nx && b.y === ny)) {
    s.alive = false;
    s.cause = wall ? 'wall' : 'self';
    ev.push({ type: 'died', cause: s.cause, x: nx, y: ny });
    return;
  }
  s.body.unshift({ x: nx, y: ny });
  if (s.grow > 0) s.grow--; else s.body.pop();
  s.moves++;
  ev.push({ type: 'moved' });

  const i = s.food.findIndex((f) => f.x === nx && f.y === ny);
  if (i >= 0) {
    const f = s.food.splice(i, 1)[0];
    const points = FOOD_POINTS[f.kind];
    s.grow += points;
    if (f.kind !== 'bead') s.score += points;
    s.eaten++;
    ev.push({ type: 'ate', kind: f.kind, x: nx, y: ny, points: f.kind === 'bead' ? 0 : points });
  }

  if (boost && ++s.boostMoves % BURN_EVERY === 0 && s.body.length > MIN_LEN) {
    const t = s.body.pop()!;
    if (!s.food.some((f) => f.x === t.x && f.y === t.y))
      s.food.push({ id: s.nextId++, kind: 'bead', x: t.x, y: t.y, born: s.tick });
    ev.push({ type: 'burn', x: t.x, y: t.y });
  }
}

/** Advance one tick. `turn` is a direction or -1; `boost` is whether boost is held. */
export function step(s: State, turn: number, boost: boolean | 0 | 1): GameEvent[] {
  const ev: GameEvent[] = [];
  if (!s.alive) return ev;
  s.tick++;
  enqueue(s, turn);
  if (s.tick >= s.nextMove) {
    const boosting = !!boost && s.body.length >= BOOST_MIN;
    move(s, boosting, ev);
    s.lastMove = s.tick;
    s.nextMove = s.tick + moveInterval(s, boosting);
  }
  s.food = s.food.filter((f) => f.kind !== 'firefly' || s.tick - f.born < FIREFLY_TTL);
  if (s.alive) topUp(s);
  return ev;
}

/** Rebuild a run. `ticks` is the last tick to simulate; stops early on death. */
export function replay(cfg: Config, inputs: Input[], ticks: number): State {
  const s = createGame(cfg);
  let i = 0, boost: 0 | 1 = 0;
  for (let t = 1; t <= ticks && s.alive; t++) {
    let turn = -1;
    while (i < inputs.length && inputs[i].t <= t) {
      if (inputs[i].t === t && inputs[i].d >= 0) turn = inputs[i].d;
      boost = inputs[i].b;
      i++;
    }
    step(s, turn, boost);
  }
  return s;
}

/** FNV-1a over the whole state, for determinism checks. */
export function hash(s: State): number {
  let h = 0x811c9dc5;
  const mix = (n: number) => { h = Math.imul(h ^ (n & 0xffff), 0x01000193); h = Math.imul(h ^ (n >>> 16), 0x01000193); };
  [s.tick, s.rng, s.score, s.grow, s.dir, s.alive ? 1 : 0, s.eaten, s.nextMove, s.moves].forEach(mix);
  s.body.forEach((b) => { mix(b.x); mix(b.y); });
  s.food.forEach((f) => { mix(f.id); mix(f.x); mix(f.y); mix(f.born); });
  return h >>> 0;
}
