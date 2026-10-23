import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DX, DY, TPS, createGame, step, type Difficulty, type Input } from '../sim/sim.ts';
import { createStore, type Store } from './store.ts';
import { MAX_TICKS, startRun, submitRun } from './runs.ts';
import { createPlayer, leaderboard, normalizeCode, playerFromCode, restorePlayer, updateName, updateSettings } from './players.ts';
import { checkName } from './names.ts';

const T0 = 1_000_000;
const grid = { cols: 30, rows: 30 };

// Plays a run the way Game.tsx does (greedy bot, a boost burst, records inputs), then runs straight into a wall.
function play(seed: number, cols: number, rows: number, difficulty: Difficulty = 'medium') {
  const s = createGame({ seed, cols, rows, difficulty });
  const inputs: Input[] = [];
  let boost: 0 | 1 = 0;
  for (let t = 0; s.alive && t < 20000; t++) {
    let turn = -1;
    if (t < 1800) {
      let bd = 1e9;
      for (let d = 0; d < 4; d++) {
        if ((d + 2) % 4 === s.dir) continue;
        const nx = s.body[0].x + DX[d], ny = s.body[0].y + DY[d];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || s.body.slice(0, -1).some((b) => b.x === nx && b.y === ny)) continue;
        const dist = Math.min(...s.food.map((f) => Math.abs(f.x - nx) + Math.abs(f.y - ny)));
        if (dist < bd) { bd = dist; turn = d; }
      }
    }
    const b: 0 | 1 = t >= 600 && t < 780 ? 1 : 0;
    if (turn >= 0 || b !== boost) { inputs.push({ t: s.tick + 1, d: turn, b }); boost = b; }
    step(s, turn, b);
  }
  assert.equal(s.alive, false);
  return { inputs, ticks: s.tick, score: s.score };
}
const after = (ticks: number) => T0 + (ticks * 1000) / TPS + 2000; // a believable submit time

async function issue(store: Store = createStore(':memory:'), playerId: string | null = null, difficulty: Difficulty = 'medium') {
  const r = await startRun(store, { ...grid, difficulty }, playerId, T0);
  assert.equal(r.status, 200);
  return { store, ...(r.body as { runId: string; seed: number; cols: number; rows: number; difficulty: Difficulty }) };
}

// store a finished run directly, for leaderboard tests that need exact scores
async function addRun(store: Store, playerId: string, difficulty: Difficulty, score: number, at = T0) {
  await store.putRun({
    id: crypto.randomUUID(), playerId, seed: 1, cols: 30, rows: 30, difficulty, issuedAt: at, used: true,
    result: { score, eaten: score, length: 3 + score, ticks: 100, cause: 'wall' }, submittedAt: at,
  });
}

test('a legitimate run is accepted and the server score matches the sim', async () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const { store, runId, seed, cols, rows } = await issue(undefined, null, difficulty);
    const run = play(seed, cols, rows, difficulty);
    const r = await submitRun(store, runId, { inputs: run.inputs, ticks: run.ticks, score: run.score }, after(run.ticks));
    assert.equal(r.status, 200, difficulty);
    assert.equal((r.body as { score: number }).score, run.score);
  }
});

test('the server replays with the difficulty it issued, not the one the client claims', async () => {
  const { store, runId, seed, cols, rows } = await issue(undefined, null, 'medium');
  const run = play(seed, cols, rows, 'easy'); // played slow, submitted as a medium run
  const r = await submitRun(store, runId, { inputs: run.inputs, ticks: run.ticks }, after(run.ticks));
  assert.equal(r.status, 422);
});

test('the server keeps its own score, even if the client sends none', async () => {
  const { store, runId, seed, cols, rows } = await issue();
  const run = play(seed, cols, rows);
  const r = await submitRun(store, runId, { inputs: run.inputs, ticks: run.ticks }, after(run.ticks));
  assert.equal((r.body as { score: number }).score, run.score);
});

test('a run can only be submitted once', async () => {
  const { store, runId, seed, cols, rows } = await issue();
  const run = play(seed, cols, rows);
  const body = { inputs: run.inputs, ticks: run.ticks, score: run.score };
  assert.equal((await submitRun(store, runId, body, after(run.ticks))).status, 200);
  assert.equal((await submitRun(store, runId, body, after(run.ticks))).status, 409);
});

test('a failed attempt burns the run, so a seed cannot be probed', async () => {
  const { store, runId, seed, cols, rows } = await issue();
  const run = play(seed, cols, rows);
  assert.equal((await submitRun(store, runId, { inputs: [], ticks: run.ticks }, after(run.ticks))).status, 422);
  assert.equal((await submitRun(store, runId, { inputs: run.inputs, ticks: run.ticks }, after(run.ticks))).status, 409);
});

test('unknown and expired runs are rejected', async () => {
  const { store, runId } = await issue();
  assert.equal((await submitRun(store, 'nope', {}, T0)).status, 404);
  assert.equal((await submitRun(store, runId, {}, T0 + 3 * 60 * 60 * 1000)).status, 410);
});

test('a paused game can still be submitted within the validity window', async () => {
  const { store, runId, seed, cols, rows } = await issue();
  const run = play(seed, cols, rows);
  const r = await submitRun(store, runId, { inputs: run.inputs, ticks: run.ticks }, after(run.ticks) + 60 * 60 * 1000); // an hour of pause
  assert.equal(r.status, 200);
});

test('tampered inputs are rejected', async () => {
  const { store, runId, seed, cols, rows } = await issue();
  const run = play(seed, cols, rows);
  const r = await submitRun(store, runId, { inputs: run.inputs.slice(0, Math.floor(run.inputs.length / 2)), ticks: run.ticks }, after(run.ticks));
  assert.equal(r.status, 422);
});

test('an inflated score claim is rejected', async () => {
  const { store, runId, seed, cols, rows } = await issue();
  const run = play(seed, cols, rows);
  const r = await submitRun(store, runId, { inputs: run.inputs, ticks: run.ticks, score: run.score + 100 }, after(run.ticks));
  assert.equal(r.status, 422);
});

test('a run submitted faster than it could be played is rejected', async () => {
  const { store, runId, seed, cols, rows } = await issue();
  const run = play(seed, cols, rows);
  assert.equal((await submitRun(store, runId, { inputs: run.inputs, ticks: run.ticks }, T0 + 100)).status, 422);
});

test('malformed submissions are rejected', async () => {
  const bad: unknown[] = [
    { inputs: [], ticks: MAX_TICKS + 1 },
    { inputs: [], ticks: 1.5 },
    { inputs: 'x', ticks: 10 },
    { inputs: [{ t: 3, d: 9, b: 0 }], ticks: 10 },
    { inputs: [{ t: 3, d: 1, b: 2 }], ticks: 10 },
    { inputs: [{ t: 5, d: 1, b: 0 }, { t: 5, d: 2, b: 0 }], ticks: 10 },
    { inputs: [{ t: 11, d: 1, b: 0 }], ticks: 10 },
    null,
  ];
  for (const body of bad) {
    const { store, runId } = await issue();
    assert.equal((await submitRun(store, runId, body, T0 + 20 * 60 * 1000)).status, 400, JSON.stringify(body));
  }
});

test('grid size and difficulty must be valid to start a run', async () => {
  const store = createStore(':memory:');
  for (const body of [{ cols: 5, rows: 20, difficulty: 'medium' }, { cols: 20, rows: 99, difficulty: 'medium' }, { cols: 'a', rows: 20, difficulty: 'medium' }, { cols: 20, rows: 20 }, { cols: 20, rows: 20, difficulty: 'nightmare' }, null])
    assert.equal((await startRun(store, body, null, T0)).status, 400, JSON.stringify(body));
});

test('issued seeds are server-made and differ per run', async () => {
  const store = createStore(':memory:');
  assert.notEqual((await issue(store)).seed, (await issue(store)).seed);
});

test('recovery codes: format, forgiving input, rejects junk', () => {
  assert.equal(normalizeCode('bite-7k3q-92xm-abcd'), '7K3Q92XMABCD');
  assert.equal(normalizeCode('7k3q 92xm abcd'), '7K3Q92XMABCD');
  assert.equal(normalizeCode('BITE-OIL0-0000-0000'), '011000000000'); // O -> 0, I and L -> 1
  for (const junk of ['', 'BITE-1234', 'BITE-7K3U-92XM-ABCD', 42, null, 'x'.repeat(100)]) assert.equal(normalizeCode(junk), null);
});

test('a player can be restored with their code, in any browser', async () => {
  const store = createStore(':memory:');
  const { playerId, code } = await createPlayer(store, T0);
  assert.match(code, /^BITE-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  const p = await playerFromCode(store, code.toLowerCase().replaceAll('-', ' '));
  assert.equal(p?.id, playerId);
  assert.equal(await playerFromCode(store, 'BITE-0000-0000-0000'), null);
  assert.equal(await restorePlayer(store, 'BITE-0000-0000-0000'), null);
});

test('the server stores a hash of the code, never the code', async () => {
  const store = createStore(':memory:');
  const { code } = await createPlayer(store, T0);
  assert.equal(await store.getPlayerByHash(code), undefined);
  assert.equal(await store.getPlayerByHash(code.replaceAll('-', '')), undefined);
});

test('verified runs build a player history and a best score per difficulty', async () => {
  const store = createStore(':memory:');
  const { playerId, code } = await createPlayer(store, T0);
  const scores: number[] = [];
  for (let i = 0; i < 3; i++) {
    const { runId, seed, cols, rows } = await issue(store, playerId);
    const run = play(seed, cols, rows);
    scores.push(run.score);
    assert.equal((await submitRun(store, runId, { inputs: run.inputs, ticks: run.ticks, score: run.score }, after(run.ticks) + i)).status, 200);
  }
  const hard = await issue(store, playerId, 'hard');
  const hardRun = play(hard.seed, hard.cols, hard.rows, 'hard');
  await submitRun(store, hard.runId, { inputs: hardRun.inputs, ticks: hardRun.ticks }, T0 + 90 * 60 * 1000); // submitted last
  await submitRun(store, (await issue(store, playerId)).runId, { inputs: [], ticks: 5 }, T0); // a rejected run must not count
  const restored = await restorePlayer(store, code);
  assert.equal(restored?.games, 4);
  assert.equal(restored?.bests.medium, Math.max(...scores));
  assert.equal(restored?.bests.hard, hardRun.score);
  assert.equal(restored?.bests.easy, 0);
  assert.equal(restored?.recent.length, 4);
  assert.equal(restored?.recent[0].difficulty, 'hard'); // newest first
});

test('anonymous runs verify but belong to nobody', async () => {
  const store = createStore(':memory:');
  const { playerId } = await createPlayer(store, T0);
  const { runId, seed, cols, rows } = await issue(store, null);
  const run = play(seed, cols, rows);
  assert.equal((await submitRun(store, runId, { inputs: run.inputs, ticks: run.ticks }, after(run.ticks))).status, 200);
  assert.equal((await store.getPlayerStats(playerId)).games, 0);
});

// --- settings: stored on the server with the player, so they follow the recovery code ---

test('new players get default settings', async () => {
  const store = createStore(':memory:');
  const { stats } = await createPlayer(store, T0);
  assert.deepEqual(stats.settings, { difficulty: 'medium', sound: true });
});

test('settings are saved on the server and come back with the recovery code', async () => {
  const store = createStore(':memory:');
  const { code } = await createPlayer(store, T0);
  const p = (await playerFromCode(store, code))!;
  assert.equal((await updateSettings(store, p, { difficulty: 'hard', sound: false })).status, 200);
  const restored = await restorePlayer(store, code.toLowerCase()); // "another browser"
  assert.deepEqual(restored?.settings, { difficulty: 'hard', sound: false });
});

test('a partial settings update keeps the other value', async () => {
  const store = createStore(':memory:');
  const { code } = await createPlayer(store, T0);
  await updateSettings(store, (await playerFromCode(store, code))!, { difficulty: 'easy' });
  const p = (await playerFromCode(store, code))!;
  assert.deepEqual(p.settings, { difficulty: 'easy', sound: true });
  await updateSettings(store, p, { sound: false });
  assert.deepEqual((await playerFromCode(store, code))!.settings, { difficulty: 'easy', sound: false });
});

test('bad settings are rejected and change nothing', async () => {
  const store = createStore(':memory:');
  const { code } = await createPlayer(store, T0);
  const p = (await playerFromCode(store, code))!;
  for (const body of [{ difficulty: 'nightmare' }, { sound: 'yes' }, { difficulty: 5 }]) assert.equal((await updateSettings(store, p, body)).status, 400);
  assert.deepEqual((await playerFromCode(store, code))!.settings, { difficulty: 'medium', sound: true });
});

// --- display names ---

test('names: valid ones pass, bad ones say why', () => {
  for (const ok of ['Chomp', 'GrapeSnake', 'a_b-c', 'Noodle99', 'abc']) assert.equal(checkName(ok).ok, true, ok);
  for (const bad of ['ab', 'x'.repeat(17), 'has space', 'emoji🐍', '', null, 42, 'sh1t', 'F_U_C_K', 'snake-1234', 'Admin', 'RobinhoodFan', 'BiteClubOfficial'])
    assert.equal(checkName(bad).ok, false, String(bad));
});

test('names are unique, ignoring case, and a player can keep their own', async () => {
  const store = createStore(':memory:');
  const a = (await playerFromCode(store, (await createPlayer(store, T0)).code))!;
  const b = (await playerFromCode(store, (await createPlayer(store, T0)).code))!;
  assert.equal((await updateName(store, a, { name: 'Chomp' })).status, 200);
  assert.equal((await updateName(store, b, { name: 'chomp' })).status, 409);
  assert.equal((await updateName(store, a, { name: 'Chomp' })).status, 200); // same player, same name
  assert.equal((await updateName(store, a, { name: 'CHOMP' })).status, 200); // and a recase of their own
  assert.equal((await updateName(store, b, { name: 'sh1t' })).status, 400);
});

// --- leaderboard ---

test('leaderboard ranks each player by their best score, per difficulty', async () => {
  const store = createStore(':memory:');
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push((await createPlayer(store, T0 + i)).playerId);
  await addRun(store, ids[0], 'medium', 10); await addRun(store, ids[0], 'medium', 40); // best 40, counted once
  await addRun(store, ids[1], 'medium', 25);
  await addRun(store, ids[2], 'hard', 99); // other difficulty
  const b = (await leaderboard(store, 'medium', null))!;
  assert.deepEqual(b.rows.map((r) => [r.rank, r.score]), [[1, 40], [2, 25]]);
  assert.deepEqual((await leaderboard(store, 'hard', null))!.rows.map((r) => r.score), [99]);
  assert.deepEqual((await leaderboard(store, 'easy', null))!.rows, []);
});

test('leaderboard: default names, chosen names, ties share a rank, zero scores are left out', async () => {
  const store = createStore(':memory:');
  const a = await createPlayer(store, T0), b = await createPlayer(store, T0 + 1), c = await createPlayer(store, T0 + 2);
  await updateName(store, (await playerFromCode(store, a.code))!, { name: 'Chomp' });
  await addRun(store, a.playerId, 'easy', 30); await addRun(store, b.playerId, 'easy', 30); await addRun(store, c.playerId, 'easy', 0);
  const rows = (await leaderboard(store, 'easy', null))!.rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.rank), [1, 1]);
  assert.equal(rows[0].name, 'Chomp'); // earlier player first on a tie
  assert.match(rows[1].name, /^snake-[0-9A-F]{4}$/);
});

test('leaderboard shows the viewer their own rank even outside the top', async () => {
  const store = createStore(':memory:');
  const me = await createPlayer(store, T0);
  for (let i = 1; i <= 12; i++) await addRun(store, (await createPlayer(store, T0 + i)).playerId, 'medium', 100 + i);
  await addRun(store, me.playerId, 'medium', 5);
  const viewer = (await playerFromCode(store, me.code))!;
  const b = (await leaderboard(store, 'medium', viewer, 10))!;
  assert.equal(b.rows.length, 10);
  assert.equal(b.rows.some((r) => r.you), false);
  assert.deepEqual(b.you, { rank: 13, score: 5 });
  assert.equal((await leaderboard(store, 'medium', null, 10))!.you, null);
  assert.equal(await leaderboard(store, 'nightmare', null), null);
});

test('the viewer is marked in the top rows', async () => {
  const store = createStore(':memory:');
  const me = await createPlayer(store, T0);
  await addRun(store, me.playerId, 'hard', 50);
  const b = (await leaderboard(store, 'hard', (await playerFromCode(store, me.code))!))!;
  assert.equal(b.rows[0].you, true);
});

// --- database upgrade ---

test('an old database without settings, names or difficulty is upgraded in place', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'biteclub-'));
  const path = join(dir, 'old.db');
  try {
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE players (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
              CREATE TABLE runs (id TEXT PRIMARY KEY, player_id TEXT REFERENCES players(id), seed INTEGER NOT NULL, cols INTEGER NOT NULL, rows INTEGER NOT NULL,
                issued_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, score INTEGER, eaten INTEGER, length INTEGER, ticks INTEGER, cause TEXT, submitted_at INTEGER);
              INSERT INTO players VALUES ('p1', 'hash1', 1);
              INSERT INTO runs VALUES ('r1', 'p1', 1, 30, 30, 1, 1, 12, 12, 15, 200, 'wall', 2);`);
    old.close();
    const store = createStore(path);
    const stats = await store.getPlayerStats('p1');
    assert.deepEqual(stats.settings, { difficulty: 'medium', sound: true });
    assert.equal(stats.name, null);
    assert.equal(stats.games, 1);
    assert.equal(stats.bests.medium, 12); // the old run keeps its score, filed under medium
    assert.equal(await store.setName('p1', 'Chomp'), true);
    createStore(path); // opening it again must not fail on the existing columns
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows keeps the file locked while the store is open */ } }
});
