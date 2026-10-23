import { getStore } from '../../../../src/server/store.ts';
import { clientIp, json, limited } from '../../../../src/server/http.ts';
import { issueNonce } from '../../../../src/server/wallet.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A one-time nonce for a sign-in message. It expires in 5 minutes and works once.
export async function GET(req: Request) {
  if (limited(`nonce:${clientIp(req)}`, 30, 10 * 60 * 1000)) return json({ error: 'too many requests' }, 429);
  return json(await issueNonce(getStore(), Date.now()));
}
