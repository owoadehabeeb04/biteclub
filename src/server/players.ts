// Anonymous players with a recovery code. The code is the credential: the server stores only its hash,
// the browser keeps the code in localStorage, and typing it in another browser restores the same player.
import { createHash } from 'node:crypto';
import { DIFFICULTIES, type Difficulty } from '../sim/sim.ts';
import { checkName, defaultName } from './names.ts';
import { DEFAULT_SETTINGS, type BoardRow, type Player, type PlayerStats, type Settings, type Store } from './store.ts';

// Crockford base32: no I, L, O, U. 12 characters = 60 bits, shown as BITE-XXXX-XXXX-XXXX.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const hash = (normalized: string) => createHash('sha256').update(normalized).digest('hex');
export const formatCode = (n: string) => `BITE-${n.slice(0, 4)}-${n.slice(4, 8)}-${n.slice(8)}`;

function generate(): string {
  // 256 is a multiple of 32, so masking the low 5 bits is uniform
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => ALPHABET[b & 31]).join('');
}

/** Canonical 12-char form of whatever the player typed, or null if it can't be a code. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  let s = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (s.length === 16 && s.startsWith('BITE')) s = s.slice(4); // generated codes never contain I, so no clash
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  return s.length === 12 && [...s].every((c) => ALPHABET.includes(c)) ? s : null;
}

export async function createPlayer(store: Store, now: number): Promise<{ playerId: string; code: string; stats: PlayerStats }> {
  const id = crypto.randomUUID(), code = generate();
  await store.createPlayer({ id, codeHash: hash(code), createdAt: now });
  // the only time the server ever has the plain code
  return { playerId: id, code: formatCode(code), stats: await store.getPlayerStats(id) };
}

/** Another credential for an existing player, e.g. for a new browser that signed in with the player's wallet. Shown once. */
export async function mintCredential(store: Store, playerId: string, now: number): Promise<string> {
  const code = generate();
  await store.addCredential(playerId, hash(code), now);
  return formatCode(code);
}

export async function playerFromCode(store: Store, raw: unknown): Promise<Player | null> {
  const n = normalizeCode(raw);
  return n ? (await store.getPlayerByHash(hash(n))) ?? null : null;
}

export async function restorePlayer(store: Store, raw: unknown): Promise<(PlayerStats & { code: string }) | null> {
  const n = normalizeCode(raw), p = n ? await store.getPlayerByHash(hash(n)) : undefined;
  return n && p ? { ...(await store.getPlayerStats(p.id)), code: formatCode(n) } : null;
}

/** Validate and save settings. Unknown fields are ignored, and a missing field keeps its current value. */
export async function updateSettings(store: Store, p: Player, body: unknown): Promise<{ status: number; body: Settings | { error: string } }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const difficulty = b.difficulty === undefined ? p.settings.difficulty : b.difficulty;
  const sound = b.sound === undefined ? p.settings.sound : b.sound;
  if (!DIFFICULTIES.includes(difficulty as Difficulty) || typeof sound !== 'boolean') return { status: 400, body: { error: 'bad settings' } };
  const next: Settings = { difficulty: difficulty as Difficulty, sound };
  await store.setSettings(p.id, next);
  return { status: 200, body: next };
}

export async function updateName(store: Store, p: Player, body: unknown): Promise<{ status: number; body: { name: string } | { error: string } }> {
  const c = checkName((body as { name?: unknown } | null)?.name);
  if (!c.ok) return { status: 400, body: { error: c.error } };
  if (!(await store.setName(p.id, c.name))) return { status: 409, body: { error: 'Someone already has that name.' } };
  return { status: 200, body: { name: c.name } };
}

export interface Board { difficulty: Difficulty; rows: { rank: number; name: string; score: number; you: boolean }[]; you: { rank: number; score: number } | null }

/** Top players for a difficulty. When the viewer is a known player, their own rank is included even outside the top. */
export async function leaderboard(store: Store, difficulty: unknown, viewer: Player | null, limit = 10): Promise<Board | null> {
  if (!DIFFICULTIES.includes(difficulty as Difficulty)) return null;
  const d = difficulty as Difficulty;
  const top: BoardRow[] = await store.leaderboard(d, limit);
  const rows: Board['rows'] = [];
  let prev = 0, rank = 0;
  for (const [i, r] of top.entries()) {
    if (r.best !== prev) { rank = i + 1; prev = r.best; } // ties share a rank
    rows.push({ rank, name: r.name ?? defaultName(r.playerId), score: r.best, you: r.playerId === viewer?.id });
  }
  const mine = viewer ? await store.bestOf(viewer.id, d) : 0;
  return { difficulty: d, rows, you: mine > 0 ? { rank: await store.rankOf(d, mine), score: mine } : null };
}

export { DEFAULT_SETTINGS };
