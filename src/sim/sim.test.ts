import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOST_MIN, DIFFICULTIES, createGame, hash, maxSpeedLevel, moveInterval, replay, speedLevel, step, type Config, type Difficulty, type Input, type State } from './sim.ts';

const cfg: Config = { seed: 12345, cols: 30, rows: 30, difficulty: 'medium' };

// a fixed pseudo-random input script, independent of the sim's own PRNG
function script(ticks: number): Input[] {
  const out: Input[] = [];
  let x = 7;
  for (let t = 1; t <= ticks; t++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    if (x % 27 === 0) out.push({ t, d: (x >>> 8) % 4, b: ((x >>> 12) % 3 === 0 ? 1 : 0) });
  }
  return out;
}

function run(c: Config, inputs: Input[], ticks: number): State {
  const s = createGame(c);
  let i = 0, boost: 0 | 1 = 0;
  for (let t = 1; t <= ticks && s.alive; t++) {
    let turn = -1;
    if (i < inputs.length && inputs[i].t === t) { turn = inputs[i].d; boost = inputs[i].b; i++; }
    step(s, turn, boost);
  }
  return s;
}

// a clean board with a known snake, no random food in the way
function setup(body: [number, number][], dir: 0 | 1 | 2 | 3 = 1, difficulty: Difficulty = 'medium'): State {
  const s = createGame({ seed: 1, cols: 40, rows: 40, difficulty });
  s.body = body.map(([x, y]) => ({ x, y }));
  s.dir = dir;
  s.food = [];
  return s;
}
// step until n moves have happened (a move takes several ticks), giving the turn on the first tick
function moves(s: State, n: number, turn = -1, boost = false): number {
  let moved = 0;
  for (let guard = 0; guard < 100_000 && moved < n && s.alive; guard++)
    if (step(s, guard === 0 ? turn : -1, boost).some((e) => e.type === 'moved')) moved++;
  return moved;
}
const ticks = (s: State, n: number, turn = -1, boost = false) => { for (let i = 0; i < n; i++) step(s, i === 0 ? turn : -1, boost); };

test('same seed and inputs give the same result', () => {
  const inputs = script(1800);
  assert.equal(hash(run(cfg, inputs, 1800)), hash(run(cfg, inputs, 1800)));
  assert.notEqual(hash(run(cfg, inputs, 1800)), hash(run({ ...cfg, seed: 999 }, inputs, 1800)));
});

test('the same inputs play out differently on a different difficulty', () => {
  const inputs = script(1800);
  assert.notEqual(hash(run(cfg, inputs, 1800)), hash(run({ ...cfg, difficulty: 'hard' }, inputs, 1800)));
});

test('replay() reproduces a live run', () => {
  const inputs = script(1800);
  for (const difficulty of DIFFICULTIES) {
    const c = { ...cfg, difficulty };
    const live = run(c, inputs, 1800);
    const re = replay(c, inputs, 1800);
    assert.equal(hash(re), hash(live));
    assert.equal(re.score, live.score);
  }
});

test('cannot reverse into the neck', () => {
  const s = setup([[10, 10], [9, 10], [8, 10]], 1);
  moves(s, 1, 3); // left, a 180 from facing right
  moves(s, 5);
  assert.ok(s.alive);
  assert.equal(s.dir, 1);
  assert.ok(s.body[0].x > 10);
});

test('two quick turns are both kept (buffer)', () => {
  const s = setup([[10, 10], [9, 10], [8, 10]], 1);
  step(s, 0, false); // up
  step(s, 3, false); // then left, in the very next tick
  moves(s, 4);
  assert.equal(s.dir, 3);
  assert.ok(s.body[0].y < 10 && s.body[0].x < 10);
});

test('hitting the wall ends the run', () => {
  const s = setup([[38, 10], [37, 10], [36, 10]], 1);
  moves(s, 6);
  assert.equal(s.alive, false);
  assert.equal(s.cause, 'wall');
});

test('hitting your own body ends the run', () => {
  const s = setup([[10, 10], [9, 10], [8, 10], [7, 10], [6, 10], [5, 10]], 1);
  for (const d of [2, 3, 0]) moves(s, 1, d); // down, left, up into the body
  assert.equal(s.alive, false);
  assert.equal(s.cause, 'self');
});

test('the tail tile is safe to enter when not growing', () => {
  // 2x2 loop facing down: the next tile (10,11) is the tail, which moves away this tick
  const s = setup([[10, 10], [11, 10], [11, 11], [10, 11]], 2);
  moves(s, 1);
  assert.ok(s.alive);
  assert.deepEqual(s.body[0], { x: 10, y: 11 });
});

for (const [kind, points] of [['berry', 1], ['beetle', 2], ['firefly', 5], ['bead', 1]] as const) {
  test(`eating a ${kind} grows by ${points}`, () => {
    const s = setup([[10, 10], [9, 10], [8, 10]], 1);
    s.food = [{ id: 99, kind, x: 11, y: 10, born: 0 }];
    moves(s, 1 + points + 2);
    assert.equal(s.body.length, 3 + points);
    assert.equal(s.score, kind === 'bead' ? 0 : points);
    assert.equal(s.eaten, 1);
  });
}

test('boost moves faster and burns length into beads', () => {
  const body: [number, number][] = [[10, 10], [9, 10], [8, 10], [7, 10], [6, 10], [5, 10], [4, 10]];
  const slow = setup(body, 1), fast = setup(body, 1);
  ticks(slow, 60);
  ticks(fast, 60, -1, true);
  assert.ok(fast.body[0].x > slow.body[0].x);
  assert.ok(fast.body.length < 7);
  assert.ok(fast.food.some((f) => f.kind === 'bead'));
});

test('boost is refused when too short', () => {
  const s = setup([[10, 10], [9, 10], [8, 10]], 1);
  assert.ok(s.body.length < BOOST_MIN);
  ticks(s, 60, -1, true); // medium starts at 12 ticks per move, so 5 moves
  assert.equal(s.body[0].x, 15);
  assert.equal(s.body.length, 3);
});

test('food stays topped up and never overlaps the snake', () => {
  const s = run(cfg, script(1200), 1200);
  assert.ok(s.food.filter((f) => f.kind === 'berry').length >= 4 || !s.alive);
  for (const f of s.food) assert.ok(!s.body.some((b) => b.x === f.x && b.y === f.y));
});

test('a run starts slow: medium makes 5 moves in its first second', () => {
  const s = setup([[10, 10], [9, 10], [8, 10]], 1);
  ticks(s, 60);
  assert.equal(s.moves, 5);
});

test('the snake speeds up as the score grows, down to a floor', () => {
  for (const d of DIFFICULTIES) {
    const s = setup([[10, 10], [9, 10], [8, 10]], 1, d);
    const seen: number[] = [];
    for (let score = 0; score <= 400; score += 4) { s.score = score; seen.push(moveInterval(s, false)); }
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i] <= seen[i - 1], `${d} never slows down`);
    assert.ok(seen[0] > seen[seen.length - 1], `${d} actually speeds up`);
    assert.equal(seen[seen.length - 1], seen[seen.length - 2], `${d} has a floor`);
    s.score = 0; assert.equal(speedLevel(s), 1);
    s.score = 100000; assert.equal(speedLevel(s), maxSpeedLevel(d));
  }
});

test('harder difficulties start faster and top out faster', () => {
  const at = (d: Difficulty, score: number) => moveInterval({ cfg: { ...cfg, difficulty: d }, score }, false);
  assert.ok(at('hard', 0) < at('medium', 0) && at('medium', 0) < at('easy', 0));
  assert.ok(at('hard', 9999) < at('medium', 9999) && at('medium', 9999) < at('easy', 9999));
});

test('boost halves the interval but never goes below 2 ticks', () => {
  const s = setup([[10, 10], [9, 10], [8, 10]], 1, 'hard');
  assert.equal(moveInterval(s, true), 4); // hard starts at 8 ticks per move, boosted 4
  s.score = 9999;
  assert.equal(moveInterval(s, true), 2); // top speed is 3 ticks, boosted would be 2 (the floor)
});

test('the speed-up takes effect on the move after eating', () => {
  const s = setup([[10, 10], [9, 10], [8, 10]], 1);
  s.score = 7; // one point short of the first speed-up on medium
  s.food = [{ id: 99, kind: 'berry', x: 11, y: 10, born: 0 }];
  moves(s, 1); // eats, score 8
  assert.equal(s.nextMove - s.lastMove, 10); // medium starts at 11 ticks per move, one tick faster now
});
