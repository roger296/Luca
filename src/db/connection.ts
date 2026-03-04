import knex from 'knex';
import type { Knex } from 'knex';

// ---------------------------------------------------------------------------
// Knex singleton — shared across the application.
//
// In tests, use the 'test' environment by setting NODE_ENV=test.
// The test database runs on port 5433 (see knexfile.ts).
// ---------------------------------------------------------------------------

const env = process.env['NODE_ENV'] === 'test' ? 'test' : 'development';

const connectionConfig: Knex.Config =
  env === 'test'
    ? {
        client: 'pg',
        connection: process.env['TEST_DATABASE_URL'] || {
          host: 'localhost',
          port: 5433,
          database: 'gl_ledger_test',
          user: 'gl_admin',
          password: 'gl_test_password',
        },
      }
    : {
        client: 'pg',
        connection: process.env['DATABASE_URL'] || {
          host: 'localhost',
          port: 5432,
          database: 'gl_ledger',
          user: 'gl_admin',
          password: 'gl_dev_password_change_me',
        },
      };

export const db: Knex = knex(connectionConfig);
