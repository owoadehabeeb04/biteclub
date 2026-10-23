import { createPlayer } from '../../../src/server/players.ts';
import { getStore } from '../../../src/server/store.ts';
import { clientIp, json, limited } from '../../../src/server/http.ts';

export const runtime = 'nodejs';

// Create an anonymous player. The response is the only time the server shows the recovery code.
export async function POST(req: Request) {
  if (limited(`create:${clientIp(req)}`, 30, 60 * 60 * 1000)) return json({ error: 'too many requests' }, 429);
  return json(await createPlayer(getStore(), Date.now()));
}
