import type { Knex } from 'knex';

// MVP Migration 1 — Chart of accounts table
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('accounts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('code', 20).notNullable();
    table.string('name', 255).notNullable();
    // ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
    table.string('category', 50).notNullable();
    // CURRENT_ASSET, FIXED_ASSET, CURRENT_LIABILITY, LONG_TERM_LIABILITY,
    // DIRECT_COSTS, OVERHEADS, FINANCE_COSTS, OTHER_INCOME
    table.string('type', 50).nullable();
    table.boolean('active').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['code']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('accounts');
}
