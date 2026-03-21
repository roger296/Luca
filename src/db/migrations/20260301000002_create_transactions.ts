import type { Knex } from 'knex';

// MVP Migration 3 — Transactions and transaction lines (the GL mirror)
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('transactions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // Business key e.g. TXN-2026-03-00001
    table.string('transaction_id', 30).notNullable();
    table.string('transaction_type', 50).notNullable();
    table.string('reference', 255).nullable();
    table.date('date').notNullable();
    // Logical reference to periods.period_id (no FK — tenant isolation handled at app layer)
    table.string('period_id', 10).notNullable();
    table.text('description').nullable();
    table.string('counterparty_trading_account_id', 100).nullable();
    table.string('counterparty_contact_id', 100).nullable();
    table.string('source_module', 100).nullable();
    table.string('source_reference', 255).nullable();
    table.string('correlation_id', 255).nullable();
    // Prevents duplicate submissions
    table.string('idempotency_key', 255).nullable();
    // Chain file position
    table.integer('chain_sequence').nullable();
    table.string('chain_hash', 64).nullable();
    // POSTED is the only valid status for committed transactions
    table.string('status', 20).notNullable().defaultTo('POSTED');
    table.timestamp('posted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['transaction_id']);
    table.unique(['idempotency_key']);
  });

  await knex.schema.createTable('transaction_lines', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // Logical reference to transactions.transaction_id (no FK — multi-tenant safe)
    table.string('transaction_id', 30).notNullable();
    // Logical reference to accounts.code
    table.string('account_code', 20).notNullable();
    table.string('description', 255).nullable();
    // All monetary values stored as NUMERIC(19,4) — never float
    table.decimal('debit', 19, 4).notNullable().defaultTo(0);
    table.decimal('credit', 19, 4).notNullable().defaultTo(0);
    table.string('cost_centre', 50).nullable();
    table.string('department', 50).nullable();
    table.integer('line_number').notNullable();

    table.index(['transaction_id']);
    table.index(['account_code']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('transaction_lines');
  await knex.schema.dropTable('transactions');
}
