// The Postgres Store, for deploys (Vercel has no writable disk, so the SQLite file store cannot run there).
// It talks to the database through a tiny `Db` interface, so the same code runs on a real server (via postgres.js) in
// production and on PGlite (Postgres compiled to WebAssembly) in tests.
import type { Difficulty } from '../sim/sim.ts';
import { DEFAULT_SETTINGS, parseSettings, type BoardRow, type Cause, type Player, type PlayerStats, type RunRecord, type Store } from './store.ts';

export interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; count: number }>;
  /** Several statements at once, no parameters. Used for the schema. */
  exec(text: string): Promise<void>;
}

// BIGINT for anything that can pass 2^31: millisecond timestamps and 32-bit seeds. Postgres hands those back as strings.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  name TEXT,
  wallet TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id),
  seed BIGINT NOT NULL,
  cols INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  issued_at BIGINT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  score INTEGER, eaten INTEGER, length INTEGER, ticks INTEGER, cause TEXT,
  submitted_at BIGINT
);
CREATE TABLE IF NOT EXISTS credentials (
  code_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS siwe_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_player ON runs (player_id, submitted_at);
CREATE INDEX IF NOT EXISTS runs_board ON runs (difficulty, score);
CREATE INDEX IF NOT EXISTS credentials_player ON credentials (player_id);
CREATE UNIQUE INDEX IF NOT EXISTS players_name ON players (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS players_wallet ON players (wallet);
`;

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const isUnique = (e: unknown) => (e as { code?: string })?.code === '23505';

const toPlayer = (r: Row): Player => ({
  id: r.id as string, createdAt: num(r.created_at), name: (r.name as string | null) ?? null,
  settings: parseSettings(r.settings), wallet: (r.wallet as string | null) ?? null,
});

export function createPgStore(db: Db): Store {
  // The schema is created once per process, before the first query. Several serverless instances can start together, so
  // it runs inside a transaction holding an advisory lock, which stops them tripping over each other's CREATE TABLEs.
  let ready: Promise<void> | null = null;
  const init = () => (ready ??= db.exec(`BEGIN; SELECT pg_advisory_xact_lock(76543210); ${SCHEMA} COMMIT;`).catch((e) => { ready = null; throw e; }));
  const q = async (text: string, params: unknown[] = []) => { await init(); return db.query(text, params); };

  return {
    async getRun(id) {
      const r = (await q('SELECT * FROM runs WHERE id = $1', [id])).rows[0];
      if (!r) return undefined;
      return {
        id: r.id as string, playerId: (r.player_id as string | null) ?? null, seed: num(r.seed),
        cols: num(r.cols), rows: num(r.rows), difficulty: r.difficulty as Difficulty,
        issuedAt: num(r.issued_at), used: !!r.used,
        result: r.score === null ? undefined : { score: num(r.score), eaten: num(r.eaten), length: num(r.length), ticks: num(r.ticks), cause: (r.cause as Cause) ?? null },
        submittedAt: numOrNull(r.submitted_at) ?? undefined,
      } satisfies RunRecord;
    },
    async putRun(r) {
      await q(
        `INSERT INTO runs (id, player_id, seed, cols, rows, difficulty, issued_at, used, score, eaten, length, ticks, cause, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET player_id = EXCLUDED.player_id, seed = EXCLUDED.seed, cols = EXCLUDED.cols, rows = EXCLUDED.rows,
           difficulty = EXCLUDED.difficulty, issued_at = EXCLUDED.issued_at, used = EXCLUDED.used, score = EXCLUDED.score, eaten = EXCLUDED.eaten,
           length = EXCLUDED.length, ticks = EXCLUDED.ticks, cause = EXCLUDED.cause, submitted_at = EXCLUDED.submitted_at`,
        [r.id, r.playerId, r.seed, r.cols, r.rows, r.difficulty, r.issuedAt, r.used,
          r.result?.score ?? null, r.result?.eaten ?? null, r.result?.length ?? null, r.result?.ticks ?? null, r.result?.cause ?? null, r.submittedAt ?? null],
      );
    },
    async purgeStale(before) {
      await q('DELETE FROM runs WHERE score IS NULL AND issued_at < $1', [before]);
    },
    async createPlayer(p) {
      await q('INSERT INTO players (id, code_hash, created_at, settings) VALUES ($1, $2, $3, $4)', [p.id, p.codeHash, p.createdAt, JSON.stringify(DEFAULT_SETTINGS)]);
    },
    async getPlayerByHash(hash) {
      // the player's original code or any credential minted later, in one round trip
      const r = (await q(
        `SELECT id, created_at, name, settings, wallet FROM players WHERE code_hash = $1
         UNION ALL
         SELECT p.id, p.created_at, p.name, p.settings, p.wallet FROM credentials c JOIN players p ON p.id = c.player_id WHERE c.code_hash = $1
         LIMIT 1`, [hash],
      )).rows[0];
      return r ? toPlayer(r) : undefined;
    },
    async addCredential(playerId, hash, createdAt) {
      await q('INSERT INTO credentials (code_hash, player_id, created_at) VALUES ($1, $2, $3)', [hash, playerId, createdAt]);
    },
    async getPlayerByWallet(address) {
      const r = (await q('SELECT id, created_at, name, settings, wallet FROM players WHERE wallet = $1', [address])).rows[0];
      return r ? toPlayer(r) : undefined;
    },
    async linkWallet(playerId, address) {
      try {
        const res = await q('UPDATE players SET wallet = $1 WHERE id = $2 AND wallet IS NULL', [address, playerId]);
        return res.count === 1 ? 'ok' : 'player-has-wallet';
      } catch (e) { if (isUnique(e)) return 'wallet-taken'; throw e; }
    },
    async putNonce(nonce, expiresAt, now) {
      await q('DELETE FROM siwe_nonces WHERE expires_at < $1', [now]); // tidy up old ones
      await q('INSERT INTO siwe_nonces (nonce, expires_at) VALUES ($1, $2)', [nonce, expiresAt]);
    },
    async hasNonce(nonce, now) {
      return (await q('SELECT 1 AS x FROM siwe_nonces WHERE nonce = $1 AND expires_at > $2', [nonce, now])).rows.length > 0;
    },
    async consumeNonce(nonce, now) {
      return (await q('DELETE FROM siwe_nonces WHERE nonce = $1 AND expires_at > $2', [nonce, now])).count === 1;
    },
    async getPlayerStats(playerId) {
      // four independent lookups, sent together instead of one after another
      const [pRes, bestRes, gamesRes, recentRes] = await Promise.all([
        q('SELECT name, settings, wallet FROM players WHERE id = $1', [playerId]),
        q('SELECT difficulty, MAX(score) AS b FROM runs WHERE player_id = $1 AND score IS NOT NULL GROUP BY difficulty', [playerId]),
        q('SELECT COUNT(*) AS n FROM runs WHERE player_id = $1 AND score IS NOT NULL', [playerId]),
        q(`SELECT score, eaten, length, ticks, cause, difficulty, submitted_at AS at FROM runs
            WHERE player_id = $1 AND score IS NOT NULL ORDER BY submitted_at DESC LIMIT 10`, [playerId]),
      ]);
      const p = pRes.rows[0];
      const bests: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
      for (const r of bestRes.rows) if ((r.difficulty as string) in bests) bests[r.difficulty as Difficulty] = num(r.b);
      return {
        playerId, name: (p?.name as string | null) ?? null, wallet: (p?.wallet as string | null) ?? null, settings: parseSettings(p?.settings), bests,
        games: num(gamesRes.rows[0].n),
        recent: recentRes.rows.map((r) => ({ score: num(r.score), eaten: num(r.eaten), length: num(r.length), ticks: num(r.ticks), cause: (r.cause as Cause) ?? null, difficulty: r.difficulty as Difficulty, at: num(r.at) })),
      } satisfies PlayerStats;
    },
    async setSettings(playerId, s) {
      await q('UPDATE players SET settings = $1 WHERE id = $2', [JSON.stringify(s), playerId]);
    },
    async setName(playerId, name) {
      try { await q('UPDATE players SET name = $1 WHERE id = $2', [name, playerId]); return true; }
      catch (e) { if (isUnique(e)) return false; throw e; }
    },
    async leaderboard(difficulty, limit) {
      return (await q(
        `SELECT p.id AS id, p.name AS name, MAX(r.score) AS best FROM runs r JOIN players p ON p.id = r.player_id
         WHERE r.difficulty = $1 AND r.score > 0 GROUP BY p.id ORDER BY best DESC, p.created_at ASC LIMIT $2`, [difficulty, limit],
      )).rows.map((r): BoardRow => ({ playerId: r.id as string, name: (r.name as string | null) ?? null, best: num(r.best) }));
    },
    async rankOf(difficulty, best) {
      const r = (await q(
        `SELECT COUNT(*) AS n FROM (SELECT MAX(score) AS b FROM runs WHERE difficulty = $1 AND score > 0 AND player_id IS NOT NULL GROUP BY player_id) t WHERE b > $2`,
        [difficulty, best],
      )).rows[0];
      return num(r.n) + 1;
    },
    async bestOf(playerId, difficulty) {
      const r = (await q('SELECT MAX(score) AS b FROM runs WHERE player_id = $1 AND difficulty = $2 AND score IS NOT NULL', [playerId, difficulty])).rows[0];
      return numOrNull(r.b) ?? 0;
    },
  };
}
