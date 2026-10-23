import { leaderboard } from '../../../src/server/players.ts';
import { getStore } from '../../../src/server/store.ts';
import { authPlayer, json } from '../../../src/server/http.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Top scores for ?difficulty=easy|medium|hard. With an x-player-code header the caller's own rank is included.
export async function GET(req: Request) {
  const p = await authPlayer(req);
  if (p === 'invalid') return json({ error: 'unknown player' }, 401);
  const board = await leaderboard(getStore(), new URL(req.url).searchParams.get('difficulty'), p);
  return board ? json(board) : json({ error: 'bad difficulty' }, 400);
}
