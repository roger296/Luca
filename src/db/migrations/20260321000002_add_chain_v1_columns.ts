import type { Knex } from 'knex';

// V1 Migration 2 — Chain V1 columns: module signatures and Merkle support
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('transactions', (table) => {
    table.jsonb('module_signature').nullable();
    table.integer('merkle_index').nullable();
  });

  await knex.schema.alterTable('periods', (table) => {
    table.string('merkle_root', 64).nullable();
    table.jsonb('sub_ledger_reconciliations').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('periods', (table) => {
    table.dropColumn('sub_ledger_reconciliations');
    table.dropColumn('merkle_root');
  });

  await knex.schema.alterTable('transactions', (table) => {
    table.dropColumn('merkle_index');
    table.dropColumn('module_signature');
  });
}
