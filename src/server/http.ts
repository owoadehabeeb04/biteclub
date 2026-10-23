// Small helpers shared by the route handlers.
import { getStore } from './store.ts';
import { playerFromCode } from './players.ts';
import type { Player } from './store.ts';

export const clientIp = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';

/** Parse a JSON body with a size cap. Returns the value, or an HTTP status when the body is unusable. */
export async function readJson(req: Request, maxBytes: number): Promise<{ value: unknown } | { status: number }> {
  const text = await req.text();
  if (text.length > maxBytes) return { status: 413 };
  try { return { value: JSON.parse(text) }; } catch { return { status: 400 }; }
}

// ponytail: per-process counters. On serverless each instance counts separately, so move this to Redis (Upstash) on deploy.
const hits = new Map<string, { n: number; reset: number }>();
export function limited(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const h = hits.get(key);
  if (!h || now > h.reset) {
    if (hits.size > 10_000) hits.clear();
    hits.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  return ++h.n > max;
}

/** The player named by the x-player-code header: a Player, null when no header is sent, or 'invalid'. */
export async function authPlayer(req: Request): Promise<Player | null | 'invalid'> {
  const code = req.headers.get('x-player-code');
  if (!code) return null;
  return (await playerFromCode(getStore(), code)) ?? 'invalid';
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });
