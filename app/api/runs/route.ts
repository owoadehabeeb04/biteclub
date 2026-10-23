import { startRun } from '../../../src/server/runs.ts';
import { getStore } from '../../../src/server/store.ts';
import { authPlayer, clientIp, json, limited, readJson } from '../../../src/server/http.ts';

export const runtime = 'nodejs';

// Start a run: the server picks the seed. With a valid x-player-code the verified run is saved to that player.
export async function POST(req: Request) {
  if (limited(`start:${clientIp(req)}`, 60, 60 * 1000)) return json({ error: 'too many requests' }, 429);
  const player = await authPlayer(req);
  if (player === 'invalid') return json({ error: 'unknown player' }, 401);
  const body = await readJson(req, 1000);
  if ('status' in body) return json({ error: 'bad request' }, body.status);
  const r = await startRun(getStore(), body.value, player?.id ?? null, Date.now());
  return json(r.body, r.status);
}
