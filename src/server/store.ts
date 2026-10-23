// All database access lives here, behind the Store interface. Everything else is storage-agnostic.
// Local dev uses Node's built-in SQLite (a file under .data/). The SQL is plain, so moving to Postgres
// for deploy means re-implementing this one file (e.g. with Prisma). Vercel's disk is not persistent.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DIFFICULTIES, type Difficulty } from '../sim/sim.ts';

export type Cause = 'wall' | 'self' | null;
export interface RunResult { score: number; eaten: number; length: number; ticks: number; cause: Cause }
export interface RunRecord {
  id: string;
  playerId: string | null; // null for anonymous runs
  seed: number;
  cols: number;
  rows: number;
  difficulty: Difficulty;
  issuedAt: number; // ms
  used: boolean; // burned on the first submit attempt, valid or not
  result?: RunResult; // set once verified
  submittedAt?: number;
}

/** Per-player settings. They live on the server with the player, so they follow the recovery code to any browser. */
export interface Settings { difficulty: Difficulty; sound: boolean }
export const DEFAULT_SETTINGS: Settings = { difficulty: 'medium', sound: true };

export interface Player { id: string; createdAt: number; name: string | null; settings: Settings; wallet: string | null }
export interface PlayerStats {
  playerId: string;
  name: string | null;
  wallet: string | null; // lowercase 0x address once a wallet is linked
  settings: Settings;
  bests: Record<Difficulty, number>; // best verified score on each difficulty
  games: number;
  recent: (RunResult & { at: number; difficulty: Difficulty })[]; // newest first
}
export interface BoardRow { playerId: string; name: string | null; best: number }

export interface Store {
  getRun(id: string): Promise<RunRecord | undefined>;
  putRun(r: RunRecord): Promise<void>;
  purgeStale(issuedBefore: number): Promise<void>; // drop never-submitted runs
  createPlayer(p: { id: string; codeHash: string; createdAt: number }): Promise<void>;
  /** Finds the player for a credential hash: the original recovery code or any credential added later. */
  getPlayerByHash(codeHash: string): Promise<Player | undefined>;
  /** Another credential for the same player, e.g. minted when they sign in with their wallet in a new browser. */
  addCredential(playerId: string, codeHash: string, createdAt: number): Promise<void>;
  getPlayerByWallet(address: string): Promise<Player | undefined>;
  /** One wallet per player and one player per wallet. */
  linkWallet(playerId: string, address: string): Promise<'ok' | 'wallet-taken' | 'player-has-wallet'>;
  /** One-time sign-in nonces. consumeNonce succeeds once, and only before expiry. */
  putNonce(nonce: string, expiresAt: number, now: number): Promise<void>;
  hasNonce(nonce: string, now: number): Promise<boolean>;
  consumeNonce(nonce: string, now: number): Promise<boolean>;
  getPlayerStats(playerId: string): Promise<PlayerStats>;
  setSettings(playerId: string, s: Settings): Promise<void>;
  /** Returns false when another player already has the name (case-insensitive). */
  setName(playerId: string, name: string): Promise<boolean>;
  /** Each player's best score on a difficulty, highest first. Zero scores are left out. */
  leaderboard(difficulty: Difficulty, limit: number): Promise<BoardRow[]>;
  /** 1 + the number of players with a strictly better best score. Ties share a rank. */
  rankOf(difficulty: Difficulty, best: number): Promise<number>;
  /** A player's own best on a difficulty, 0 if none. */
  bestOf(playerId: string, difficulty: Difficulty): Promise<number>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id),
  seed INTEGER NOT NULL,
  cols INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  issued_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  score INTEGER, eaten INTEGER, length INTEGER, ticks INTEGER, cause TEXT,
  submitted_at INTEGER
);
CREATE TABLE IF NOT EXISTS credentials (
  code_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS siwe_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
`;

// Added after the first release. Existing databases get them via addColumn below, so no data is lost.
const INDEXES = `
CREATE INDEX IF NOT EXISTS runs_player ON runs (player_id, submitted_at);
CREATE INDEX IF NOT EXISTS runs_board ON runs (difficulty, score);
CREATE UNIQUE INDEX IF NOT EXISTS players_name ON players (name COLLATE NOCASE);
CREATE UNIQUE INDEX IF NOT EXISTS players_wallet ON players (wallet);
CREATE INDEX IF NOT EXISTS credentials_player ON credentials (player_id);
`;

type Row = Record<string, number | string | null>;

function addColumn(db: DatabaseSync, table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

function parseSettings(raw: unknown): Settings {
  try {
    const s = JSON.parse(String(raw ?? '{}'));
    return {
      difficulty: DIFFICULTIES.includes(s.difficulty) ? s.difficulty : DEFAULT_SETTINGS.difficulty,
      sound: typeof s.sound === 'boolean' ? s.sound : DEFAULT_SETTINGS.sound,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

const toPlayer = (r: Row): Player => ({
  id: r.id as string, createdAt: r.created_at as number, name: r.name as string | null,
  settings: parseSettings(r.settings), wallet: (r.wallet as string | null) ?? null,
});

export function createStore(path: string): Store {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  addColumn(db, 'players', 'settings', `TEXT NOT NULL DEFAULT '{}'`);
  addColumn(db, 'players', 'name', 'TEXT');
  addColumn(db, 'players', 'wallet', 'TEXT');
  addColumn(db, 'runs', 'difficulty', `TEXT NOT NULL DEFAULT 'medium'`);
  db.exec(INDEXES);
  const q = (sql: string) => db.prepare(sql);

  return {
    async getRun(id) {
      const r = q('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
      if (!r) return undefined;
      return {
        id: r.id as string, playerId: r.player_id as string | null, seed: r.seed as number,
        cols: r.cols as number, rows: r.rows as number, difficulty: r.difficulty as Difficulty,
        issuedAt: r.issued_at as number, used: !!r.used,
        result: r.score === null ? undefined : { score: r.score as number, eaten: r.eaten as number, length: r.length as number, ticks: r.ticks as number, cause: r.cause as Cause },
        submittedAt: (r.submitted_at as number | null) ?? undefined,
      };
    },
    async putRun(r) {
      q(`INSERT OR REPLACE INTO runs (id, player_id, seed, cols, rows, difficulty, issued_at, used, score, eaten, length, ticks, cause, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        r.id, r.playerId, r.seed, r.cols, r.rows, r.difficulty, r.issuedAt, r.used ? 1 : 0,
        r.result?.score ?? null, r.result?.eaten ?? null, r.result?.length ?? null, r.result?.ticks ?? null, r.result?.cause ?? null,
        r.submittedAt ?? null,
      );
    },
    async purgeStale(before) {
      q('DELETE FROM runs WHERE score IS NULL AND issued_at < ?').run(before);
    },
    async createPlayer(p) {
      q('INSERT INTO players (id, code_hash, created_at, settings) VALUES (?, ?, ?, ?)').run(p.id, p.codeHash, p.createdAt, JSON.stringify(DEFAULT_SETTINGS));
    },
    async getPlayerByHash(hash) {
      const r = (q('SELECT id, created_at, name, settings, wallet FROM players WHERE code_hash = ?').get(hash)
        ?? q(`SELECT p.id, p.created_at, p.name, p.settings, p.wallet FROM credentials c JOIN players p ON p.id = c.player_id WHERE c.code_hash = ?`).get(hash)) as Row | undefined;
      return r ? toPlayer(r) : undefined;
    },
    async addCredential(playerId, hash, createdAt) {
      q('INSERT INTO credentials (code_hash, player_id, created_at) VALUES (?, ?, ?)').run(hash, playerId, createdAt);
    },
    async getPlayerByWallet(address) {
      const r = q('SELECT id, created_at, name, settings, wallet FROM players WHERE wallet = ?').get(address) as Row | undefined;
      return r ? toPlayer(r) : undefined;
    },
    async linkWallet(playerId, address) {
      try {
        const res = q('UPDATE players SET wallet = ? WHERE id = ? AND wallet IS NULL').run(address, playerId);
        return Number(res.changes) === 1 ? 'ok' : 'player-has-wallet';
      } catch (e) { if (/UNIQUE/i.test(String((e as Error).message))) return 'wallet-taken'; throw e; }
    },
    async putNonce(nonce, expiresAt, now) {
      q('DELETE FROM siwe_nonces WHERE expires_at < ?').run(now); // tidy up old ones
      q('INSERT INTO siwe_nonces (nonce, expires_at) VALUES (?, ?)').run(nonce, expiresAt);
    },
    async hasNonce(nonce, now) {
      return !!q('SELECT 1 AS x FROM siwe_nonces WHERE nonce = ? AND expires_at > ?').get(nonce, now);
    },
    async consumeNonce(nonce, now) {
      return Number(q('DELETE FROM siwe_nonces WHERE nonce = ? AND expires_at > ?').run(nonce, now).changes) === 1;
    },
    async getPlayerStats(playerId) {
      const p = q('SELECT name, settings, wallet FROM players WHERE id = ?').get(playerId) as Row | undefined;
      const bests: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
      for (const r of q('SELECT difficulty, MAX(score) AS b FROM runs WHERE player_id = ? AND score IS NOT NULL GROUP BY difficulty').all(playerId) as Row[])
        if (r.difficulty! in bests) bests[r.difficulty as Difficulty] = r.b as number;
      const games = (q('SELECT COUNT(*) AS n FROM runs WHERE player_id = ? AND score IS NOT NULL').get(playerId) as Row).n as number;
      const recent = q(`SELECT score, eaten, length, ticks, cause, difficulty, submitted_at AS at FROM runs
                        WHERE player_id = ? AND score IS NOT NULL ORDER BY submitted_at DESC LIMIT 10`).all(playerId) as Row[];
      return {
        playerId, name: (p?.name as string | null) ?? null, wallet: (p?.wallet as string | null) ?? null, settings: parseSettings(p?.settings), bests, games,
        recent: recent.map((r) => ({ score: r.score as number, eaten: r.eaten as number, length: r.length as number, ticks: r.ticks as number, cause: r.cause as Cause, difficulty: r.difficulty as Difficulty, at: r.at as number })),
      };
    },
    async setSettings(playerId, s) {
      q('UPDATE players SET settings = ? WHERE id = ?').run(JSON.stringify(s), playerId);
    },
    async setName(playerId, name) {
      try { q('UPDATE players SET name = ? WHERE id = ?').run(name, playerId); return true; }
      catch (e) { if (/UNIQUE/i.test(String((e as Error).message))) return false; throw e; }
    },
    async leaderboard(difficulty, limit) {
      return (q(`SELECT p.id AS id, p.name AS name, MAX(r.score) AS best FROM runs r JOIN players p ON p.id = r.player_id
                 WHERE r.difficulty = ? AND r.score > 0 GROUP BY p.id ORDER BY best DESC, p.created_at ASC LIMIT ?`).all(difficulty, limit) as Row[])
        .map((r) => ({ playerId: r.id as string, name: r.name as string | null, best: r.best as number }));
    },
    async rankOf(difficulty, best) {
      const r = q(`SELECT COUNT(*) AS n FROM (SELECT MAX(score) AS b FROM runs WHERE difficulty = ? AND score > 0 AND player_id IS NOT NULL GROUP BY player_id) WHERE b > ?`).get(difficulty, best) as Row;
      return (r.n as number) + 1;
    },
    async bestOf(playerId, difficulty) {
      const r = q('SELECT MAX(score) AS b FROM runs WHERE player_id = ? AND difficulty = ? AND score IS NOT NULL').get(playerId, difficulty) as Row;
      return (r.b as number | null) ?? 0;
    },
  };
}

const g = globalThis as { __biteclubStore?: Store };
/** The app-wide store. Cached on globalThis so dev hot reloads don't reopen the file. */
export function getStore(): Store {
  return (g.__biteclubStore ??= createStore(process.env.BITECLUB_DB ?? '.data/biteclub.db'));
}
