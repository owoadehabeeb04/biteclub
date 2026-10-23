import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { createStore, type Player, type Store } from './store.ts';
import { createPlayer, normalizeCode, playerFromCode } from './players.ts';
import { issueNonce, verifyWallet, NONCE_TTL_MS, type WalletResult } from './wallet.ts';

const HOST = 'localhost:3000';
const T0 = 1_800_000_000_000;
const MIN = 60_000;

const newWallet = () => privateKeyToAccount(generatePrivateKey());
type Account = ReturnType<typeof newWallet>;

interface Opts { host?: string; domain?: string; uri?: string; nonce?: string; issuedAt?: number; expiresAt?: number; chainId?: number; address?: string; signer?: Account }

// Build and sign a SIWE message the way the browser does, with knobs for breaking it
async function prepare(store: Store, account: Account, o: Opts = {}) {
  const { nonce } = await issueNonce(store, T0);
  const issued = o.issuedAt ?? T0;
  const message = createSiweMessage({
    address: (o.address ?? account.address) as `0x${string}`,
    chainId: o.chainId ?? 46630,
    domain: o.domain ?? HOST,
    nonce: o.nonce ?? nonce,
    uri: o.uri ?? `http://${HOST}`,
    version: '1',
    statement: 'Sign in to BITECLUB. This is free and sends nothing to the blockchain.',
    issuedAt: new Date(issued),
    expirationTime: new Date(o.expiresAt ?? issued + 10 * MIN),
  });
  const signature = await (o.signer ?? account).signMessage({ message });
  return { message, signature, nonce };
}
const send = (store: Store, p: { message: string; signature: string }, viewer: Player | null = null, o: { switchOk?: boolean; now?: number; host?: string } = {}) =>
  verifyWallet(store, { message: p.message, signature: p.signature, host: o.host ?? HOST, viewer, switchOk: o.switchOk ?? false, now: o.now ?? T0 });
const signIn = async (store: Store, account: Account, viewer: Player | null = null, o: Opts & { switchOk?: boolean; now?: number } = {}) =>
  send(store, await prepare(store, account, o), viewer, o);
const ok = (r: { status: number; body: unknown }) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body as WalletResult; };
const err = (r: { status: number; body: unknown }, status: number) => { assert.equal(r.status, status, JSON.stringify(r.body)); return (r.body as { error: string }).error; };

async function player(store: Store) {
  const p = await createPlayer(store, T0);
  return { ...p, viewer: (await playerFromCode(store, p.code))! };
}
const addRun = (store: Store, playerId: string, score: number) => store.putRun({
  id: crypto.randomUUID(), playerId, seed: 1, cols: 30, rows: 30, difficulty: 'medium', issuedAt: T0, used: true,
  result: { score, eaten: score, length: 3 + score, ticks: 100, cause: 'wall' }, submittedAt: T0,
});

test('a wallet with no player yet gets a new player and a credential', async () => {
  const store = createStore(':memory:'), w = newWallet();
  const r = ok(await signIn(store, w));
  assert.equal(r.created, true);
  assert.ok(r.code && normalizeCode(r.code));
  assert.equal(r.address, w.address.toLowerCase());
  assert.equal(r.stats.wallet, w.address.toLowerCase());
  assert.equal((await playerFromCode(store, r.code))?.id, r.playerId);
});

test('signing in links the wallet to this browser\'s player, without a new credential', async () => {
  const store = createStore(':memory:'), w = newWallet(), p = await player(store);
  const r = ok(await signIn(store, w, p.viewer));
  assert.equal(r.playerId, p.playerId);
  assert.equal(r.code, undefined);
  assert.equal(r.switched, false);
  assert.equal(r.stats.wallet, w.address.toLowerCase());
  assert.equal((await store.getPlayerByWallet(w.address.toLowerCase()))?.id, p.playerId);
});

test('signing in again with the same wallet on the same player is harmless', async () => {
  const store = createStore(':memory:'), w = newWallet(), p = await player(store);
  ok(await signIn(store, w, p.viewer));
  const again = ok(await signIn(store, w, p.viewer));
  assert.equal(again.code, undefined);
  assert.equal(again.playerId, p.playerId);
});

test('a fresh browser signs in with the wallet and gets the same player back', async () => {
  const store = createStore(':memory:'), w = newWallet();
  const home = await player(store);
  await addRun(store, home.playerId, 20);
  ok(await signIn(store, w, home.viewer)); // link it at home
  const blank = await player(store); // the new browser auto-created an empty player
  const r = ok(await signIn(store, w, blank.viewer));
  assert.equal(r.playerId, home.playerId);
  assert.equal(r.switched, true);
  assert.ok(r.code);
  assert.equal(r.stats.games, 1); // the scores came with it
  assert.equal((await playerFromCode(store, r.code!))?.id, home.playerId); // the new credential works
  assert.equal((await playerFromCode(store, home.code))?.id, home.playerId); // and the original one still does
  assert.notEqual(r.code, home.code);
});

test('the server stores only hashes of the credentials it mints', async () => {
  const store = createStore(':memory:'), w = newWallet(), home = await player(store);
  ok(await signIn(store, w, home.viewer));
  const r = ok(await signIn(store, w, (await player(store)).viewer));
  assert.equal(await store.getPlayerByHash(r.code!), undefined);
  assert.equal(await store.getPlayerByHash(r.code!.replaceAll('-', '')), undefined);
});

test('signing in without any player (a browser with nothing saved) just logs in', async () => {
  const store = createStore(':memory:'), w = newWallet(), home = await player(store);
  ok(await signIn(store, w, home.viewer));
  const r = ok(await signIn(store, w, null));
  assert.equal(r.playerId, home.playerId);
  assert.equal(r.switched, false);
  assert.ok(r.code);
  assert.equal(r.created, false);
});

test('switching away from a player with verified runs needs a yes, and the sign-in survives the wait', async () => {
  const store = createStore(':memory:'), w = newWallet();
  const home = await player(store);
  ok(await signIn(store, w, home.viewer));
  const here = await player(store);
  await addRun(store, here.playerId, 5); // this browser's player has progress
  const signed = await prepare(store, w);
  const first = await send(store, signed, here.viewer);
  assert.equal(err(first, 409), 'needs_confirm');
  assert.equal((first.body as unknown as { games: number }).games, 1);
  assert.equal(await store.hasNonce(signed.nonce, T0), true); // not spent
  const second = ok(await send(store, signed, here.viewer, { switchOk: true }));
  assert.equal(second.playerId, home.playerId);
  assert.equal(second.switched, true);
  assert.equal((await playerFromCode(store, here.code))?.id, here.playerId); // the player it left is untouched
});

test('a player with no runs is switched without asking', async () => {
  const store = createStore(':memory:'), w = newWallet();
  ok(await signIn(store, w, (await player(store)).viewer));
  assert.equal(ok(await signIn(store, w, (await player(store)).viewer)).switched, true);
});

test('a player already linked to one wallet cannot take a second wallet', async () => {
  const store = createStore(':memory:'), a = newWallet(), b = newWallet(), p = await player(store);
  ok(await signIn(store, a, p.viewer));
  const signed = await prepare(store, b);
  const viewer = (await playerFromCode(store, p.code))!; // reload so it knows about wallet A
  assert.match(err(await send(store, signed, viewer), 409), /already linked to a different wallet/);
  assert.equal(await store.getPlayerByWallet(b.address.toLowerCase()), undefined);
  assert.equal(await store.hasNonce(signed.nonce, T0), true); // refused before the nonce was spent
});

test('a sign-in can only be used once', async () => {
  const store = createStore(':memory:'), w = newWallet(), p = await player(store);
  const signed = await prepare(store, w);
  ok(await send(store, signed, p.viewer));
  assert.match(err(await send(store, signed, p.viewer), 401), /already used|expired/);
});

test('a nonce the server never issued is rejected', async () => {
  const store = createStore(':memory:'), w = newWallet();
  assert.match(err(await signIn(store, w, null, { nonce: 'deadbeefdeadbeef' }), 401), /expired|already used/);
});

test('a nonce expires after 5 minutes', async () => {
  const store = createStore(':memory:'), w = newWallet();
  const signed = await prepare(store, w);
  assert.equal(ok(await send(store, signed, null, { now: T0 + NONCE_TTL_MS - 1000 })).created, true); // still fine just before
  const late = await prepare(store, newWallet());
  assert.match(err(await send(store, late, null, { now: T0 + NONCE_TTL_MS + 1000 }), 401), /expired|already used/);
});

test('a message signed for another site is rejected', async () => {
  const store = createStore(':memory:'), w = newWallet();
  assert.match(err(await signIn(store, w, null, { domain: 'evil.example' }), 401), /not valid for this site/);
});

test('a uri on another site is rejected', async () => {
  const store = createStore(':memory:'), w = newWallet();
  assert.match(err(await signIn(store, w, null, { uri: 'http://evil.example' }), 401), /not valid for this site/);
});

test('an expired message is rejected', async () => {
  const store = createStore(':memory:'), w = newWallet();
  err(await signIn(store, w, null, { issuedAt: T0 - 5 * MIN, expiresAt: T0 - MIN }), 401);
});

test('a message issued long ago is rejected even if it has not expired', async () => {
  const store = createStore(':memory:'), w = newWallet();
  err(await signIn(store, w, null, { issuedAt: T0 - 20 * MIN, expiresAt: T0 + 30 * MIN, now: T0 }), 401);
});

test('a message that lives too long is rejected', async () => {
  const store = createStore(':memory:'), w = newWallet();
  err(await signIn(store, w, null, { expiresAt: T0 + 24 * 60 * MIN }), 401);
});

test('a message issued in the future is rejected', async () => {
  const store = createStore(':memory:'), w = newWallet();
  err(await signIn(store, w, null, { issuedAt: T0 + 10 * MIN, expiresAt: T0 + 20 * MIN }), 401);
});

test('a signature from a different key is rejected', async () => {
  const store = createStore(':memory:'), w = newWallet(), other = newWallet();
  assert.match(err(await signIn(store, w, null, { signer: other }), 401), /does not match/);
});

test('claiming someone else\'s address in the message is rejected', async () => {
  const store = createStore(':memory:'), mine = newWallet(), victim = newWallet();
  assert.match(err(await signIn(store, mine, null, { address: victim.address }), 401), /does not match/);
  assert.equal(await store.getPlayerByWallet(victim.address.toLowerCase()), undefined);
});

test('malformed input is rejected', async () => {
  const store = createStore(':memory:'), w = newWallet();
  const good = await prepare(store, w);
  const sig65 = good.signature;
  const cases: [unknown, unknown][] = [
    ['not a siwe message', sig65], [42, sig65], [null, sig65], ['x'.repeat(2000), sig65],
    [good.message, '0x1234'], [good.message, 'nope'], [good.message, undefined], [good.message, '0x' + 'ab'.repeat(200)],
  ];
  for (const [message, signature] of cases) {
    const r = await verifyWallet(store, { message, signature, host: HOST, viewer: null, switchOk: false, now: T0 });
    assert.ok(r.status === 400 || r.status === 401, `${String(message).slice(0, 20)} / ${String(signature).slice(0, 12)} -> ${r.status}`);
  }
  assert.equal((await verifyWallet(store, { message: good.message, signature: sig65, host: null, viewer: null, switchOk: false, now: T0 })).status, 400);
});

test('the wallet address is stored in lowercase whatever case the wallet used', async () => {
  const store = createStore(':memory:'), w = newWallet();
  const r = ok(await signIn(store, w, null, { address: w.address.toLowerCase() }));
  assert.equal(r.address, w.address.toLowerCase());
  assert.equal((await store.getPlayerByWallet(w.address.toLowerCase()))?.wallet, w.address.toLowerCase());
});

test('any chain id in the message is accepted, since sign-in does not depend on the network', async () => {
  const store = createStore(':memory:');
  for (const chainId of [1, 46630, 4663]) ok(await signIn(store, newWallet(), null, { chainId }));
});

test('different players cannot end up with the same wallet', async () => {
  const store = createStore(':memory:'), w = newWallet();
  const a = await player(store), b = await player(store);
  ok(await signIn(store, w, a.viewer));
  const r = ok(await signIn(store, w, b.viewer)); // b signs in with a's wallet: b switches to a, never shares
  assert.equal(r.playerId, a.playerId);
  assert.equal((await store.getPlayerStats(b.playerId)).wallet, null);
});

test('an old database without wallet support is upgraded in place', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'biteclub-'));
  const path = join(dir, 'old.db');
  try {
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE players (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, settings TEXT NOT NULL DEFAULT '{}', name TEXT);
              CREATE TABLE runs (id TEXT PRIMARY KEY, player_id TEXT REFERENCES players(id), seed INTEGER NOT NULL, cols INTEGER NOT NULL, rows INTEGER NOT NULL,
                issued_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, score INTEGER, eaten INTEGER, length INTEGER, ticks INTEGER, cause TEXT, submitted_at INTEGER,
                difficulty TEXT NOT NULL DEFAULT 'medium');
              INSERT INTO players (id, code_hash, created_at) VALUES ('p1', 'hash1', 1);`);
    old.close();
    const store = createStore(path);
    assert.equal((await store.getPlayerStats('p1')).wallet, null);
    assert.equal(await store.linkWallet('p1', '0xabc'), 'ok');
    assert.equal((await store.getPlayerByWallet('0xabc'))?.id, 'p1');
    assert.equal((await store.getPlayerByHash('hash1'))?.id, 'p1'); // the original credential still works
    createStore(path); // reopening must not fail on the existing columns
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows keeps the file locked while the store is open */ } }
});
