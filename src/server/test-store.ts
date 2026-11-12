// A fresh, empty Store for a test. By default that is the SQLite store in memory. With STORE=pg it is the Postgres store
// running on PGlite (Postgres compiled to WebAssembly), so the same tests prove both stores behave the same.
import { createStore, type Store } from './store.ts';
import { createPgStore, type Db } from './store.pg.ts';

export const PG = process.env.STORE === 'pg';

let shared: import('@electric-sql/pglite').PGlite | null = null;
let n = 0;

/** A Db over one shared PGlite, with every test in its own schema so tests cannot see each other's data. */
export async function pgliteDb(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = (shared ??= new PGlite());
  const schema = `t${++n}`;
  await pg.exec(`CREATE SCHEMA ${schema}`);
  const inSchema = async <T>(fn: () => Promise<T>) => { await pg.exec(`SET search_path TO ${schema}`); return fn(); };
  return {
    query: (text, params) => inSchema(async () => {
      const r = await pg.query(text, params as unknown[]);
      return { rows: r.rows as Record<string, unknown>[], count: r.affectedRows ?? r.rows.length };
    }),
    exec: (text) => inSchema(async () => { await pg.exec(text); }),
  };
}

export async function newStore(): Promise<Store> {
  return PG ? createPgStore(await pgliteDb()) : createStore(':memory:');
}
