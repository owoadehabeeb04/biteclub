// Display names for the leaderboard. Deliberately simple: a character rule, a reserved list, and a small
// profanity check on a de-leetspeaked copy. ponytail: substring match has false positives (the Scunthorpe
// problem) and misses creative spellings. Add a real moderation list or review queue if names get abused.

const SHAPE = /^[A-Za-z0-9_-]{3,16}$/;
// Names that would impersonate the default names, the brand, or imply an affiliation we must not imply.
const RESERVED = ['snake-', 'admin', 'moderator', 'biteclub', 'robinhood', 'official', 'support'];
const BLOCKED = [
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'whore', 'slut', 'nigg', 'fagg', 'retard',
  'nazi', 'hitler', 'porn', 'penis', 'vagina',
]; // short words that sit inside normal ones (cum, rape, anal, cock) are left out on purpose: "grape" must stay legal
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' };

export function checkName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'Pick a name.' };
  const name = raw.trim();
  if (!SHAPE.test(name)) return { ok: false, error: 'Use 3 to 16 letters, numbers, - or _.' };
  const plain = name.toLowerCase().replace(/[-_]/g, '').replace(/[0-9]/g, (c) => LEET[c] ?? c);
  if (BLOCKED.some((w) => plain.includes(w))) return { ok: false, error: 'That name isn’t allowed.' };
  const lower = name.toLowerCase();
  if (RESERVED.some((w) => lower.includes(w))) return { ok: false, error: 'That name is reserved.' };
  return { ok: true, name };
}

/** What shows on the board until a player picks a name. */
export const defaultName = (playerId: string) => `snake-${playerId.slice(-4).toUpperCase()}`;
