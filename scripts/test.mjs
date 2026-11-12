// Runs the whole test suite twice: once on the SQLite store (local development) and once on the Postgres store (what deploys use).
// A tiny runner instead of npm-script environment variables, which differ between Windows and other systems.
import { spawnSync } from 'node:child_process';

const run = (label, files, env = {}) => {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: { ...process.env, ...env } });
  return r.status === 0;
};

const sqlite = run('SQLite store', ['src/sim/sim.test.ts', 'src/server/server.test.ts', 'src/server/wallet.test.ts']);
const pg = run('Postgres store', ['src/server/server.test.ts', 'src/server/wallet.test.ts', 'src/server/store.pg.test.ts'], { STORE: 'pg' });
if (!sqlite || !pg) { console.error(`\nFAILED: ${[!sqlite && 'SQLite run', !pg && 'Postgres run'].filter(Boolean).join(' and ')}`); process.exit(1); }
console.log('\nAll tests passed on both stores.');
