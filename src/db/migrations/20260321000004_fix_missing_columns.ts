import type { Knex } from 'knex';

// V1 Migration 4 — Add missing columns and users table
// - transactions.submitted_by (who posted the transaction, for SoD checks)
// - staging.gross_amount (total debit amount in transaction currency, for delegation scope checks)
// - users table (authentication, was omitted from MVP migrations)
export async function up(knex: Knex): Promise<void> {
  // Add submitted_by to transactions (who initiated the posting)
  await knex.schema.alterTable('transactions', (table) => {
    table.string('submitted_by', 255).nullable();
  });

  // Add gross_amount to staging (total debit in transaction currency, for approval rules)
  await knex.schema.alterTable('staging', (table) => {
    table.decimal('gross_amount', 19, 4).nullable();
  });

  // Users table — authentication and role management for the single-tenant GL
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('email', 255).notNullable();
    table.string('password_hash', 255).notNullable();
    table.string('display_name', 255).notNullable();
    // Array of role strings, e.g. ['admin', 'approver', 'viewer']
    table.specificType('roles', 'TEXT[]').notNullable().defaultTo('{}');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_login_at', { useTz: true }).nullable();

    table.unique(['email']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('users');

  await knex.schema.alterTable('staging', (table) => {
    table.dropColumn('gross_amount');
  });

  await knex.schema.alterTable('transactions', (table) => {
    table.dropColumn('submitted_by');
  });
}
