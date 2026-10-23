import { restorePlayer } from '../../../../src/server/players.ts';
import { getStore } from '../../../../src/server/store.ts';
import { clientIp, json, limited, readJson } from '../../../../src/server/http.ts';

export const runtime = 'nodejs';

// Restore a player from a recovery code typed in another browser. Rate limited so codes can't be guessed.
export async function POST(req: Request) {
  if (limited(`restore:${clientIp(req)}`, 10, 10 * 60 * 1000)) return json({ error: 'too many attempts, try again later' }, 429);
  const body = await readJson(req, 1000);
  if ('status' in body) return json({ error: 'bad request' }, body.status);
  const player = await restorePlayer(getStore(), (body.value as { code?: unknown } | null)?.code);
  // same answer for a malformed code and an unknown one
  return player ? json(player) : json({ error: 'no player with that code' }, 404);
}
