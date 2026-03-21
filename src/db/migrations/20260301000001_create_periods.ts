import type { Knex } from 'knex';

// MVP Migration 2 — Accounting periods table
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('periods', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // Format: YYYY-MM (e.g. 2026-03)
    table.string('period_id', 10).notNullable();
    // OPEN, SOFT_CLOSE, HARD_CLOSE
    table.string('status', 20).notNullable().defaultTo('OPEN');
    // PROVISIONAL, AUTHORITATIVE
    table.string('data_flag', 30).notNullable().defaultTo('PROVISIONAL');
    // Hash of the genesis entry for this period's chain file
    table.string('opening_hash', 64).nullable();
    // Hash of the PERIOD_CLOSE entry — set when hard-closed
    table.string('closing_hash', 64).nullable();
    table.timestamp('opened_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('closed_at', { useTz: true }).nullable();
    table.unique(['period_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('periods');
}
