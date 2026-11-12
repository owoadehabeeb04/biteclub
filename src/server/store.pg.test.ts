import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createPgStore, type Db } from './store.pg.ts';
import { createPostgresStore } from './store.ts';
import { pgliteDb } from './test-store.ts';

const T = 1_800_000_000_000; // a millisecond timestamp, far past what a 32-bit INTEGER holds

test('big numbers survive: millisecond timestamps and 32-bit seeds', async () => {
  const store = createPgStore(await pgliteDb());
  await store.createPlayer({ id: 'p1', codeHash: 'h1', createdAt: T });
  await store.putRun({ id: 'r1', playerId: 'p1', seed: 4_294_967_295, cols: 30, rows: 30, difficulty: 'hard', issuedAt: T, used: true,
    result: { score: 9, eaten: 9, length: 12, ticks: 4000, cause: 'wall' }, submittedAt: T + 5 });
  const r = (await store.getRun('r1'))!;
  assert.equal(r.seed, 4_294_967_295);
  assert.equal(r.issuedAt, T);
  assert.equal(r.submittedAt, T + 5);
  assert.equal(typeof r.seed, 'number'); // Postgres returns bigints as strings; the store turns them back into numbers
  assert.equal((await store.getPlayerByHash('h1'))?.createdAt, T);
  assert.equal((await store.getPlayerStats('p1')).recent[0].at, T + 5);
});

test('setting up twice on the same database is harmless', async () => {
  const db = await pgliteDb();
  await createPgStore(db).createPlayer({ id: 'p1', codeHash: 'h1', createdAt: T });
  const again = createPgStore(db); // a second instance (another serverless start) runs the schema again
  assert.equal((await again.getPlayerByHash('h1'))?.id, 'p1');
});

test('several instances starting at once do not trip over each other', async () => {
  const db = await pgliteDb();
  const stores = Array.from({ length: 6 }, () => createPgStore(db));
  const results = await Promise.all(stores.map((s, i) => s.createPlayer({ id: `p${i}`, codeHash: `h${i}`, createdAt: T + i })));
  assert.equal(results.length, 6);
  assert.equal((await stores[0].getPlayerByHash('h5'))?.id, 'p5');
});

test('a failed setup is retried on the next call, not remembered forever', async () => {
  const real = await pgliteDb();
  let failed = false;
  const flaky: Db = {
    query: real.query,
    exec: async (text) => { if (!failed) { failed = true; throw new Error('database not reachable yet'); } return real.exec(text); },
  };
  const store = createPgStore(flaky);
  await assert.rejects(store.getPlayerByHash('h1'), /not reachable/);
  assert.equal(await store.getPlayerByHash('h1'), undefined); // the retry set the schema up and the query ran
});

test('names are unique ignoring case, and wallets are unique', async () => {
  const store = createPgStore(await pgliteDb());
  for (const id of ['a', 'b']) await store.createPlayer({ id, codeHash: 'h' + id, createdAt: T });
  assert.equal(await store.setName('a', 'Chomp'), true);
  assert.equal(await store.setName('b', 'cHOMP'), false);
  assert.equal(await store.setName('a', 'CHOMP'), true); // their own name, any case
  assert.equal(await store.linkWallet('a', '0xabc'), 'ok');
  assert.equal(await store.linkWallet('b', '0xabc'), 'wallet-taken');
  assert.equal(await store.linkWallet('a', '0xdef'), 'player-has-wallet');
});

// The real driver (postgres.js) that production uses, talking to a real Postgres wire-protocol server (PGlite behind a socket)
test('the production driver works against a Postgres server', async () => {
  const pg = new PGlite();
  const server = new PGLiteSocketServer({ db: pg, port: 54329, host: '127.0.0.1' });
  await server.start();
  try {
    const store = createPostgresStore('postgres://postgres:postgres@127.0.0.1:54329/postgres');
    await store.createPlayer({ id: 'p1', codeHash: 'h1', createdAt: T });
    await store.createPlayer({ id: 'p2', codeHash: 'h2', createdAt: T + 1 });
    await store.putRun({ id: 'r1', playerId: 'p1', seed: 4_000_000_000, cols: 30, rows: 30, difficulty: 'easy', issuedAt: T, used: true,
      result: { score: 7, eaten: 7, length: 10, ticks: 900, cause: 'self' }, submittedAt: T });
    const run = (await store.getRun('r1'))!;
    assert.equal(run.seed, 4_000_000_000);
    assert.equal(run.result?.score, 7);
    assert.equal(run.result?.cause, 'self');
    assert.equal(run.used, true);
    assert.deepEqual((await store.leaderboard('easy', 10)).map((r) => [r.playerId, r.best]), [['p1', 7]]);
    assert.equal(await store.rankOf('easy', 3), 2);
    assert.equal(await store.bestOf('p1', 'easy'), 7);
    assert.equal(await store.setName('p1', 'Chomp'), true);
    assert.equal(await store.setName('p2', 'chomp'), false); // a unique violation comes through the driver as code 23505
    assert.equal(await store.linkWallet('p1', '0xabc'), 'ok');
    assert.equal(await store.linkWallet('p2', '0xabc'), 'wallet-taken');
    await store.putNonce('n1', T + 1000, T);
    assert.equal(await store.hasNonce('n1', T), true);
    assert.equal(await store.consumeNonce('n1', T), true);
    assert.equal(await store.consumeNonce('n1', T), false); // one use only
    assert.equal(await store.consumeNonce('nope', T), false);
    await store.addCredential('p1', 'h1b', T);
    assert.equal((await store.getPlayerByHash('h1b'))?.id, 'p1');
    assert.equal((await store.getPlayerStats('p1')).games, 1);
  } finally { await server.stop(); await pg.close(); }
});
