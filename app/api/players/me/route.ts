import { getStore } from '../../../../src/server/store.ts';
import { authPlayer, json } from '../../../../src/server/http.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The signed-in player's best score and recent history. The recovery code goes in the x-player-code header.
export async function GET(req: Request) {
  const p = await authPlayer(req);
  if (!p || p === 'invalid') return json({ error: 'unknown player' }, 401);
  return json(await getStore().getPlayerStats(p.id));
}
