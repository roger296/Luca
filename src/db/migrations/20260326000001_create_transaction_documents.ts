import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('transaction_documents', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // Logical FK to transactions.transaction_id
    table.string('transaction_id', 30).notNullable();
    table.string('filename', 255).notNullable();
    table.string('mime_type', 100).notNullable();
    // File stored as base64 text in the DB (avoids filesystem management complexity)
    table.text('file_data').notNullable();
    table.bigInteger('file_size').notNullable();
    table.string('uploaded_by', 255).nullable();
    table.timestamp('uploaded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['transaction_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('transaction_documents');
}
