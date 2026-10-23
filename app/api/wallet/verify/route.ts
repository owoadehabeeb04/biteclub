import { getStore } from '../../../../src/server/store.ts';
import { authPlayer, clientIp, json, limited, readJson } from '../../../../src/server/http.ts';
import { verifyWallet } from '../../../../src/server/wallet.ts';

export const runtime = 'nodejs';

// Check a signed sign-in message and link the wallet to a player. With a valid x-player-code the wallet is
// linked to that player. If the wallet already belongs to another player, this browser gets a credential for
// that player (the response includes `code`, shown once).
export async function POST(req: Request) {
  if (limited(`wallet:${clientIp(req)}`, 20, 10 * 60 * 1000)) return json({ error: 'too many attempts, try again later' }, 429);
  const viewer = await authPlayer(req);
  if (viewer === 'invalid') return json({ error: 'unknown player' }, 401);
  const body = await readJson(req, 4000);
  if ('status' in body) return json({ error: 'bad request' }, body.status);
  const b = (body.value ?? {}) as { message?: unknown; signature?: unknown; switchOk?: unknown };
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const r = await verifyWallet(getStore(), { message: b.message, signature: b.signature, host, viewer, switchOk: b.switchOk === true, now: Date.now() });
  return json(r.body, r.status);
}
