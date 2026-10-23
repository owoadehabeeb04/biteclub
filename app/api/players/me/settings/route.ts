import { updateSettings } from '../../../../../src/server/players.ts';
import { getStore } from '../../../../../src/server/store.ts';
import { authPlayer, json, readJson } from '../../../../../src/server/http.ts';

export const runtime = 'nodejs';

// Save the player's settings (difficulty, sound). They live on the server with the player, so they follow the recovery code.
export async function PUT(req: Request) {
  const p = await authPlayer(req);
  if (!p || p === 'invalid') return json({ error: 'unknown player' }, 401);
  const body = await readJson(req, 1000);
  if ('status' in body) return json({ error: 'bad request' }, body.status);
  const r = await updateSettings(getStore(), p, body.value);
  return json(r.body, r.status);
}
