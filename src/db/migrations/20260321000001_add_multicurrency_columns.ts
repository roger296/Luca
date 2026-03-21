import type { Knex } from 'knex';

// V1 Migration 1 — Multi-currency columns on transactions, transaction_lines, and staging
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('transactions', (table) => {
    table.string('currency', 3).notNullable().defaultTo('GBP');
    table.decimal('exchange_rate', 19, 8).nullable();
    table.string('base_currency', 3).notNullable().defaultTo('GBP');
  });

  await knex.schema.alterTable('transaction_lines', (table) => {
    table.decimal('base_debit', 19, 4).notNullable().defaultTo(0);
    table.decimal('base_credit', 19, 4).notNullable().defaultTo(0);
  });

  await knex.schema.alterTable('staging', (table) => {
    table.string('currency', 3).notNullable().defaultTo('GBP');
    table.decimal('exchange_rate', 19, 8).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('staging', (table) => {
    table.dropColumn('exchange_rate');
    table.dropColumn('currency');
  });

  await knex.schema.alterTable('transaction_lines', (table) => {
    table.dropColumn('base_credit');
    table.dropColumn('base_debit');
  });

  await knex.schema.alterTable('transactions', (table) => {
    table.dropColumn('base_currency');
    table.dropColumn('exchange_rate');
    table.dropColumn('currency');
  });
}
