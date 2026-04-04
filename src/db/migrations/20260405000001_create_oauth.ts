import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // OAuth 2.0 clients — one per installation (created by install.sh)
  await knex.schema.createTable('oauth_clients', (t) => {
    t.string('client_id', 80).primary();
    t.string('client_secret_hash', 255).notNullable(); // bcrypt hashed
    t.string('name', 255).notNullable();
    t.specificType('redirect_uris', 'TEXT[]').notNullable().defaultTo('{}');
    t.specificType('scopes', 'TEXT[]').notNullable().defaultTo('{mcp}');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // Short-lived authorization codes (10 minute TTL)
  await knex.schema.createTable('oauth_authorization_codes', (t) => {
    t.string('code', 128).primary();
    t.string('client_id', 80).notNullable();
    t.string('user_id', 255).notNullable();
    t.string('redirect_uri', 1000).notNullable();
    t.specificType('scopes', 'TEXT[]').notNullable();
    t.string('code_challenge', 128).nullable();       // PKCE
    t.string('code_challenge_method', 10).nullable(); // S256
    t.timestamp('expires_at').notNullable();
    t.boolean('used').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.foreign('client_id').references('client_id').inTable('oauth_clients');
  });

  // Long-lived access tokens for MCP
  await knex.schema.createTable('oauth_access_tokens', (t) => {
    t.string('token_hash', 255).primary(); // SHA-256 hash of the actual token
    t.string('client_id', 80).notNullable();
    t.string('user_id', 255).notNullable();
    t.specificType('scopes', 'TEXT[]').notNullable();
    t.timestamp('expires_at').nullable(); // null = never expires
    t.timestamp('last_used_at').nullable();
    t.boolean('is_revoked').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.foreign('client_id').references('client_id').inTable('oauth_clients');
    t.index(['token_hash']);
    t.index(['user_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('oauth_access_tokens');
  await knex.schema.dropTableIfExists('oauth_authorization_codes');
  await knex.schema.dropTableIfExists('oauth_clients');
}
