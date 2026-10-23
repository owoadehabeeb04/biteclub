import { updateName } from '../../../../../src/server/players.ts';
import { getStore } from '../../../../../src/server/store.ts';
import { authPlayer, clientIp, json, limited, readJson } from '../../../../../src/server/http.ts';

export const runtime = 'nodejs';

// Set the leaderboard display name. Rate limited so names can't be scraped by guessing.
export async function PUT(req: Request) {
  if (limited(`name:${clientIp(req)}`, 20, 10 * 60 * 1000)) return json({ error: 'too many attempts, try again later' }, 429);
  const p = await authPlayer(req);
  if (!p || p === 'invalid') return json({ error: 'unknown player' }, 401);
  const body = await readJson(req, 1000);
  if ('status' in body) return json({ error: 'bad request' }, body.status);
  const r = await updateName(getStore(), p, body.value);
  return json(r.body, r.status);
}
