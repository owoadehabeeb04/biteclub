// Server-side run verification. The server issues the seed, the client plays and records inputs,
// then the server replays them with the same sim and keeps ITS score. A score from the client is never trusted.
import { DIFFICULTIES, TPS, replay, type Difficulty, type Input } from '../sim/sim.ts';
import type { RunResult, Store } from './store.ts';

export const MAX_TICKS = 30 * 60 * TPS; // 30 minutes
export const GRID = { minCols: 14, maxCols: 44, minRows: 14, maxRows: 32 }; // what the client can produce
const TTL_MS = 2 * 60 * 60 * 1000; // an issued run stays valid this long, so a paused game can still finish
const SLACK_MS = 1500;

export type Reply<T> = { status: number; body: T | { error: string } };
const fail = (status: number, error: string) => ({ status, body: { error } });
const int = (n: unknown, lo: number, hi: number): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;

/** Issue a run. `playerId` is null for anonymous play, otherwise the verified run is saved to that player. */
export async function startRun(store: Store, body: unknown, playerId: string | null, now: number): Promise<Reply<{ runId: string; seed: number; cols: number; rows: number; difficulty: Difficulty }>> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!int(b.cols, GRID.minCols, GRID.maxCols) || !int(b.rows, GRID.minRows, GRID.maxRows)) return fail(400, 'bad grid size');
  if (!DIFFICULTIES.includes(b.difficulty as Difficulty)) return fail(400, 'bad difficulty');
  const difficulty = b.difficulty as Difficulty;
  const runId = crypto.randomUUID(), seed = crypto.getRandomValues(new Uint32Array(1))[0];
  await store.purgeStale(now - 2 * TTL_MS); // abandoned runs
  await store.putRun({ id: runId, playerId, seed, cols: b.cols, rows: b.rows, difficulty, issuedAt: now, used: false });
  return { status: 200, body: { runId, seed, cols: b.cols, rows: b.rows, difficulty } };
}

function parseInputs(raw: unknown, ticks: number): Input[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_TICKS) return null;
  let last = 0;
  for (const i of raw) {
    if (!i || typeof i !== 'object' || !int(i.t, 1, ticks) || !int(i.d, -1, 3) || (i.b !== 0 && i.b !== 1) || i.t <= last) return null;
    last = i.t;
  }
  return raw.map((i) => ({ t: i.t, d: i.d, b: i.b }));
}

export async function submitRun(store: Store, id: string, body: unknown, now: number): Promise<Reply<RunResult & { verified: true }>> {
  const rec = await store.getRun(id);
  if (!rec) return fail(404, 'unknown run');
  if (rec.used) return fail(409, 'run already submitted');
  if (now - rec.issuedAt > TTL_MS) return fail(410, 'run expired');
  await store.putRun({ ...rec, used: true }); // one attempt per issued run, so a seed can't be probed with tweaked inputs

  const b = (body ?? {}) as Record<string, unknown>;
  if (!int(b.ticks, 1, MAX_TICKS)) return fail(400, 'bad ticks');
  const inputs = parseInputs(b.inputs, b.ticks);
  if (!inputs) return fail(400, 'bad inputs');
  // a run can't be submitted faster than it could have been played (TPS ticks per second in real time)
  if (now - rec.issuedAt < (b.ticks * 1000 / TPS) * 0.9 - SLACK_MS) return fail(422, 'submitted faster than the run could be played');

  const s = replay({ seed: rec.seed, cols: rec.cols, rows: rec.rows, difficulty: rec.difficulty }, inputs, b.ticks);
  // solo runs only end by dying, and exactly on the tick the client claims
  if (s.alive || s.tick !== b.ticks) return fail(422, 'run does not end where claimed');
  // the client's score is only a consistency check; the stored score is always the server's
  if (b.score !== undefined && b.score !== s.score) return fail(422, 'score mismatch');

  const result: RunResult = { score: s.score, eaten: s.eaten, length: s.body.length, ticks: s.tick, cause: s.cause };
  await store.putRun({ ...rec, used: true, result, submittedAt: now });
  return { status: 200, body: { verified: true, ...result } };
}
