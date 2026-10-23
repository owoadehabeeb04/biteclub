import { submitRun } from '../../../../../src/server/runs.ts';
import { getStore } from '../../../../../src/server/store.ts';
import { clientIp, json, limited, readJson } from '../../../../../src/server/http.ts';

export const runtime = 'nodejs';

// Submit the recorded inputs. The server replays them and answers with ITS score, never the client's.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (limited(`submit:${clientIp(req)}`, 60, 60 * 1000)) return json({ error: 'too many requests' }, 429);
  const body = await readJson(req, 1_000_000);
  if ('status' in body) return json({ error: 'bad request' }, body.status);
  const { id } = await ctx.params;
  const r = await submitRun(getStore(), id, body.value, Date.now());
  return json(r.body, r.status);
}
