const { runner } = require('node-pg-migrate');
const path = require('path');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[migrations] DATABASE_URL is not set.');
  process.exit(1);
}

console.log('[migrations] Running database migrations...');

runner({
  databaseUrl,
  dir: path.join(__dirname, 'migrations'),
  direction: 'up',
  migrationsTable: 'pgmigrations',
  log: console.log,
}).then(() => {
  console.log('[migrations] Complete.');
  process.exit(0);
}).catch((err) => {
  console.error('[migrations] Failed:', err);
  process.exit(1);
});
