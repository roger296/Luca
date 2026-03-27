#!/usr/bin/env node
'use strict';

/**
 * GL V1 startup script.
 * Runs DB migrations and seeds, then starts the Express server.
 * Plain JavaScript — no TypeScript runtime required.
 *
 * The server is launched as a child process (via spawnSync) so that
 * require.main === module is true inside dist/src/server.js, which enables
 * app.listen() and the background jobs (webhook retry, approval escalation).
 */

const path = require('path');
const knex = require('knex');
const { spawnSync } = require('child_process');

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('[startup] DATABASE_URL environment variable is required');
  process.exit(1);
}

const migConfig = {
  client: 'pg',
  connection: DB_URL,
  pool: { min: 1, max: 3 },
  migrations: {
    directory: path.join(__dirname, 'dist', 'src', 'db', 'migrations'),
    loadExtensions: ['.js'],
    // Skip validation of previously-run migrations file existence.
    // Dev DB was migrated with .ts files; container has compiled .js files.
    // On a fresh DB this has no effect.
    disableMigrationsListValidation: true,
  },
  seeds: {
    directory: path.join(__dirname, 'dist', 'src', 'db', 'seeds'),
    loadExtensions: ['.js'],
  },
};

async function main() {
  const db = knex(migConfig);
  try {
    // Normalise migration file names: previous dev runs recorded .ts names;
    // the container has compiled .js files. Rename any .ts entries to .js so
    // knex recognises them as already-applied. Safe to run multiple times.
    try {
      await db.schema.hasTable('knex_migrations').then(async function(exists) {
        if (exists) {
          await db.raw("UPDATE knex_migrations SET name = REPLACE(name, '.ts', '.js') WHERE name LIKE '%.ts'");
        }
      });
    } catch (fixErr) {
      // Non-fatal: if the table doesn't exist yet, migrations will create it
    }

    console.log('[startup] Running database migrations...');
    const [batchNo, migrations] = await db.migrate.latest();
    if (migrations.length === 0) {
      console.log('[startup] No new migrations.');
    } else {
      console.log('[startup] Batch ' + batchNo + ': applied ' + migrations.length + ' migration(s):', migrations);
    }

    console.log('[startup] Running database seeds...');
    try {
      await db.seed.run();
      console.log('[startup] Seeds applied.');
    } catch (seedErr) {
      // Seeds are idempotent — duplicate key errors are expected on re-runs
      console.log('[startup] Seeds skipped or partially applied (may already exist).');
    }
  } finally {
    await db.destroy();
  }

  // Launch the server as a child process.
  // spawnSync blocks until the server exits, which is what we want for Docker.
  // Running as a child process ensures require.main === module inside server.js,
  // enabling app.listen() and the background job intervals.
  console.log('[startup] Starting GL V1 server...');
  const serverPath = path.join(__dirname, 'dist', 'src', 'server.js');
  const result = spawnSync('node', [serverPath], {
    stdio: 'inherit',
    env: process.env,
  });

  process.exit(result.status || 0);
}

main().catch(function(err) {
  console.error('[startup] Fatal error during startup:', err);
  process.exit(1);
});
