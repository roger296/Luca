import type { Knex } from 'knex';

// MVP Migration 4 — Staging (approval queue), approval rules, and transaction type mappings
export async function up(knex: Knex): Promise<void> {
  // Staging table — transactions waiting for approval
  await knex.schema.createTable('staging', (table) => {
    table.uuid('staging_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('transaction_type', 50).notNullable();
    table.string('reference', 255).nullable();
    table.date('date').notNullable();
    table.string('period_id', 10).notNullable();
    // Full transaction submission payload for processing after approval
    table.jsonb('payload').notNullable();
    // PENDING, APPROVED, REJECTED, ESCALATED
    table.string('status', 20).notNullable().defaultTo('PENDING');
    table.string('submitted_by', 255).nullable();
    table.string('required_approver', 255).nullable();
    table.string('required_approver_role', 100).nullable();
    // Approval tracking
    table.string('approved_by', 255).nullable();
    table.timestamp('approved_at', { useTz: true }).nullable();
    // Rejection tracking
    table.string('rejected_by', 255).nullable();
    table.timestamp('rejected_at', { useTz: true }).nullable();
    table.text('rejection_reason').nullable();
    // V1: multi-level approvals tracking (array of approval objects)
    table.jsonb('approvals').notNullable().defaultTo('[]');
    table.string('idempotency_key', 255).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['idempotency_key']);
    table.index(['status']);
    table.index(['period_id']);
  });

  // Approval rules — determines auto-approve vs manual review thresholds
  await knex.schema.createTable('approval_rules', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // NULL = applies to all transaction types
    table.string('transaction_type', 50).nullable();
    // Transactions below this amount are auto-approved (NULL = always require approval)
    table.decimal('auto_approve_below', 19, 4).nullable();
    // Legacy single role field (MVP)
    table.string('required_approver_role', 100).nullable();
    // V1: array of roles that can approve
    table.specificType('approval_roles', 'TEXT[]').notNullable().defaultTo('{}');
    // V1: number of approvals required (1 = single approval, 2+ = multi-level)
    table.integer('required_approvals').notNullable().defaultTo(1);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Transaction type mappings — default account codes for each transaction type
  await knex.schema.createTable('transaction_type_mappings', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('transaction_type', 50).notNullable();
    // Array of { account_code, amount_source, description_template, allow_override }
    table.jsonb('debit_rules').notNullable().defaultTo('[]');
    table.jsonb('credit_rules').notNullable().defaultTo('[]');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.unique(['transaction_type']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('transaction_type_mappings');
  await knex.schema.dropTable('approval_rules');
  await knex.schema.dropTable('staging');
}
