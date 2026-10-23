// Sign in with a wallet (SIWE, EIP-4361). The wallet proves it owns an address by signing a message that
// carries a server-issued, single-use nonce. The address is then linked to a player. Externally owned
// accounts only: they sign with a plain 65-byte signature, which we check offline.
// ponytail: smart-contract wallets (e.g. Coinbase Smart Wallet) sign via ERC-1271 and need an on-chain call.
// Add that when someone needs it: viem's verifyMessage with a public client does it.
import { recoverMessageAddress } from 'viem';
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { createPlayer, mintCredential } from './players.ts';
import type { Reply } from './runs.ts';
import type { Player, PlayerStats, Store } from './store.ts';

export const NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_MESSAGE_LEN = 1500;
const MAX_LIFETIME_MS = 15 * 60 * 1000; // how far apart issuedAt and expirationTime may be, and how old issuedAt may be
const SKEW_MS = 60 * 1000; // allowed clock difference between the phone/computer and the server
const fail = (status: number, error: string, extra: object = {}) => ({ status, body: { error, ...extra } });

export interface WalletResult {
  address: string; // lowercase
  playerId: string;
  /** A fresh credential for this browser, shown once. Present when this browser must switch to, or start as, the wallet's player. */
  code?: string;
  created: boolean; // a new player was made for this wallet
  switched: boolean; // this browser moved from another player to the wallet's player
  stats: PlayerStats;
}

export async function issueNonce(store: Store, now: number): Promise<{ nonce: string }> {
  // hex is alphanumeric, which is what EIP-4361 asks for
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  await store.putNonce(nonce, now + NONCE_TTL_MS, now);
  return { nonce };
}

export async function verifyWallet(
  store: Store,
  input: { message: unknown; signature: unknown; host: string | null; viewer: Player | null; switchOk: boolean; now: number },
): Promise<Reply<WalletResult>> {
  const { message, signature, host, viewer, switchOk, now } = input;
  if (typeof message !== 'string' || message.length > MAX_MESSAGE_LEN) return fail(400, 'bad message');
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return fail(400, 'This wallet type isn’t supported yet. Try a browser wallet such as MetaMask.');
  if (!host) return fail(400, 'bad request');

  const msg = parseSiweMessage(message);
  if (!msg.address || !msg.nonce || !msg.domain || !msg.uri || !msg.issuedAt || !msg.expirationTime || !msg.chainId || msg.version !== '1') return fail(400, 'bad message');
  // the signed site name must be this site, so a message signed for another website can't be replayed here
  if (!validateSiweMessage({ message: msg, domain: host, time: new Date(now) })) return fail(401, 'This sign-in message is not valid for this site, or it has expired.');
  let uriHost: string;
  try { uriHost = new URL(msg.uri).host; } catch { return fail(400, 'bad message'); }
  if (uriHost !== host) return fail(401, 'This sign-in message is not valid for this site.');
  const issued = msg.issuedAt.getTime(), expires = msg.expirationTime.getTime();
  if (issued > now + SKEW_MS || now - issued > MAX_LIFETIME_MS || expires - issued > MAX_LIFETIME_MS) return fail(401, 'This sign-in message is too old. Try again.');

  let recovered: string;
  try { recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` }); } catch { return fail(401, 'bad signature'); }
  if (recovered.toLowerCase() !== msg.address.toLowerCase()) return fail(401, 'The signature does not match the wallet address.');
  const address = recovered.toLowerCase();

  if (!(await store.hasNonce(msg.nonce, now))) return fail(401, 'This sign-in expired or was already used. Try again.');

  const linked = await store.getPlayerByWallet(address);
  // refuse before spending the nonce when this browser's player already belongs to a different wallet
  if (!linked && viewer?.wallet && viewer.wallet !== address) return fail(409, 'This player is already linked to a different wallet.');
  // switching away from a player that has verified runs needs the person to say yes first. The nonce stays valid for the retry.
  const switching = !!(linked && viewer && viewer.id !== linked.id);
  if (switching && !switchOk) {
    const games = (await store.getPlayerStats(viewer!.id)).games;
    if (games > 0) return fail(409, 'needs_confirm', { games });
  }

  if (!(await store.consumeNonce(msg.nonce, now))) return fail(401, 'This sign-in expired or was already used. Try again.');

  let playerId: string, code: string | undefined, created = false;
  if (linked) {
    playerId = linked.id;
    // this browser either already is that player, or needs a credential for it
    if (!viewer || viewer.id !== linked.id) code = await mintCredential(store, linked.id, now);
  } else if (viewer) {
    const r = await store.linkWallet(viewer.id, address);
    if (r !== 'ok') return fail(409, r === 'wallet-taken' ? 'This wallet was just linked to another player. Try again.' : 'This player is already linked to a different wallet.');
    playerId = viewer.id;
  } else {
    const p = await createPlayer(store, now);
    if ((await store.linkWallet(p.playerId, address)) !== 'ok') return fail(409, 'This wallet was just linked to another player. Try again.');
    playerId = p.playerId; code = p.code; created = true;
  }
  return { status: 200, body: { address, playerId, code, created, switched: switching, stats: await store.getPlayerStats(playerId) } };
}
