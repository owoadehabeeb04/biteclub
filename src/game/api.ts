// Browser side of the server API. Every call fails soft (returns null or {ok:false}), so the game stays playable offline.
import type { Difficulty, Input } from '../sim/sim.ts';

export interface Settings { difficulty: Difficulty; sound: boolean }
export const DEFAULT_SETTINGS: Settings = { difficulty: 'medium', sound: true };
export interface HistoryRun { score: number; eaten: number; length: number; ticks: number; cause: 'wall' | 'self' | null; at: number; difficulty: Difficulty }
export interface PlayerStats {
  playerId: string;
  name: string | null;
  wallet: string | null; // lowercase address once a wallet is linked
  settings: Settings;
  bests: Record<Difficulty, number>;
  games: number;
  recent: HistoryRun[];
}
export interface Board { difficulty: Difficulty; rows: { rank: number; name: string; score: number; you: boolean }[]; you: { rank: number; score: number } | null }
interface Saved { playerId: string; code: string }

const KEY = 'biteclub.player';
const SETTINGS_KEY = 'biteclub.settings';
const BESTS_KEY = 'biteclub.bests';

const read = <T>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } };
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked: lasts for this tab only */ } };

/** The player saved in this browser. The recovery code is the credential, so it lives here and is sent as a header. */
export function savedPlayer(): Saved | null {
  const s = read<Saved>(KEY);
  return s && typeof s.code === 'string' ? s : null;
}
// The server no longer knows this player (its data was reset), so this browser's saved code and local bests belong to nothing.
const forget = () => { try { localStorage.removeItem(KEY); localStorage.removeItem(BESTS_KEY); } catch { /* ignore */ } };

/** Settings cached in this browser. The server copy is the truth when online. This keeps the game usable offline. */
export const cachedSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...(read<Partial<Settings>>(SETTINGS_KEY) ?? {}) });
export const cacheSettings = (s: Settings) => write(SETTINGS_KEY, s);

/** This browser's own best per difficulty, the offline fallback for the server's bests. */
export const cachedBests = (): Record<Difficulty, number> => ({ easy: 0, medium: 0, hard: 0, ...(read<Record<string, number>>(BESTS_KEY) ?? {}) });
export const cacheBest = (d: Difficulty, score: number) => write(BESTS_KEY, { ...cachedBests(), [d]: score });

async function call(path: string, init: RequestInit = {}, withPlayer = true): Promise<Response | null> {
  const p = withPlayer ? savedPlayer() : null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    return await fetch(path, {
      ...init, signal: ctl.signal,
      headers: { 'content-type': 'application/json', ...(p ? { 'x-player-code': p.code } : {}) },
    });
  } catch { return null; } finally { clearTimeout(timer); }
}

export async function fetchMe(): Promise<PlayerStats | null> {
  const r = await call('/api/players/me');
  return r?.ok ? r.json() : null;
}

async function createPlayer(): Promise<PlayerStats | null> {
  const r = await call('/api/players', { method: 'POST' }, false);
  if (!r?.ok) return null;
  const d = await r.json();
  write(KEY, { playerId: d.playerId, code: d.code });
  return d.stats;
}

/** Load this browser's player, or create one. Null means the server is unreachable. */
export async function loadPlayer(): Promise<PlayerStats | null> {
  if (!savedPlayer()) return createPlayer();
  const r = await call('/api/players/me');
  if (!r) return null; // offline: keep the saved player, try again next time
  if (r.ok) return r.json();
  if (r.status === 401) { forget(); return createPlayer(); } // server no longer knows this code
  return null;
}

/** Switch this browser to the player behind a recovery code (typed in from another browser). */
export async function restorePlayer(code: string): Promise<{ ok: true; stats: PlayerStats } | { ok: false; error: string }> {
  const r = await call('/api/players/restore', { method: 'POST', body: JSON.stringify({ code }) }, false);
  if (!r) return { ok: false, error: 'Can\'t reach the server. Try again.' };
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: r.status === 404 ? 'No player with that code. Check it and try again.' : (d.error ?? 'Something went wrong.') };
  write(KEY, { playerId: d.playerId, code: d.code });
  return { ok: true, stats: d };
}

/** Save settings on the server with the player. Returns the saved settings, or null if it didn't go through. */
export async function saveSettings(s: Partial<Settings>): Promise<Settings | null> {
  const r = await call('/api/players/me/settings', { method: 'PUT', body: JSON.stringify(s) });
  return r?.ok ? r.json() : null;
}

export async function saveName(name: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const r = await call('/api/players/me/name', { method: 'PUT', body: JSON.stringify({ name }) });
  if (!r) return { ok: false, error: 'Can\'t reach the server. Try again.' };
  const d = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, name: d.name } : { ok: false, error: d.error ?? 'Something went wrong.' };
}

export async function fetchBoard(difficulty: Difficulty): Promise<Board | null> {
  const r = await call(`/api/leaderboard?difficulty=${difficulty}`);
  return r?.ok ? r.json() : null;
}

export interface WalletResult { address: string; playerId: string; code?: string; created: boolean; switched: boolean; stats: PlayerStats }

/** A one-time nonce for a sign-in message. */
export async function fetchNonce(): Promise<string | null> {
  const r = await call('/api/wallet/nonce', {}, false);
  return r?.ok ? (await r.json()).nonce : null;
}

/** This browser's own bests belong to the player it had. After switching players they no longer mean anything. */
export const resetLocalBests = () => { try { localStorage.removeItem(BESTS_KEY); } catch { /* ignore */ } };

/**
 * Send a signed sign-in message. If the response carries a `code`, this browser now holds a credential for the wallet's
 * player, so it is saved here. `needsConfirm` means the wallet belongs to another player and this browser's current
 * player has verified runs, so the person must agree to switch.
 */
export async function verifyWallet(message: string, signature: string, switchOk: boolean): Promise<
  { ok: true; result: WalletResult } | { ok: false; error: string; needsConfirm?: { games: number } }
> {
  const r = await call('/api/wallet/verify', { method: 'POST', body: JSON.stringify({ message, signature, switchOk }) });
  if (!r) return { ok: false, error: 'Can’t reach the server. Try again.' };
  const d = await r.json().catch(() => ({}));
  if (r.status === 409 && d.error === 'needs_confirm') return { ok: false, error: 'needs_confirm', needsConfirm: { games: d.games } };
  if (!r.ok) return { ok: false, error: d.error ?? 'Something went wrong.' };
  if (d.code) { write(KEY, { playerId: d.playerId, code: d.code }); if (d.created || d.switched) resetLocalBests(); }
  return { ok: true, result: d };
}

/** Ask the server for a run. It picks the seed and, with a saved player, files the verified run under them. */
export async function startRun(cols: number, rows: number, difficulty: Difficulty): Promise<{ runId: string; seed: number } | null> {
  const body = JSON.stringify({ cols, rows, difficulty });
  let r = await call('/api/runs', { method: 'POST', body });
  if (r?.status === 401) r = await call('/api/runs', { method: 'POST', body }, false); // stale player: play anonymously
  return r?.ok ? r.json() : null;
}

export async function submitRun(runId: string, run: { inputs: Input[]; ticks: number; score: number }): Promise<{ ok: true; score: number } | { ok: false; error: string }> {
  const r = await call(`/api/runs/${runId}/submit`, { method: 'POST', body: JSON.stringify(run) }, false);
  if (!r) return { ok: false, error: 'offline' };
  const d = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, score: d.score } : { ok: false, error: d.error ?? 'rejected' };
}
