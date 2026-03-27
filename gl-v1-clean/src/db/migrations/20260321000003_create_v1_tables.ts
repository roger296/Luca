import type { Knex } from 'knex';

// V1 Migration 3 — New V1 tables: company_settings, registered_modules, webhooks,
// approval_delegations, exchange_rates, sub_ledger_reconciliations.
// Also adds performance indexes on pre-existing tables.
export async function up(knex: Knex): Promise<void> {
  // company_settings — single-row table replacing the old multi-tenant tenants table.
  // The CHECK constraint (id = 1) enforces exactly one row can ever exist.
  await knex.schema.createTable('company_settings', (table) => {
    table.integer('id').primary().defaultTo(1);
    table.string('company_name', 255).notNullable().defaultTo('My Company');
    table.string('base_currency', 3).notNullable().defaultTo('GBP');
    // Month number 1–12. Default 4 = April (UK financial year start).
    table.integer('financial_year_start_month').notNullable().defaultTo(4);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.jsonb('settings').notNullable().defaultTo('{}');
  });
  await knex.raw(
    'ALTER TABLE company_settings ADD CONSTRAINT company_settings_single_row CHECK (id = 1)'
  );

  // registered_modules — modules that can post transactions to the GL.
  await knex.schema.createTable('registered_modules', (table) => {
    table.string('module_id', 100).primary();
    table.string('display_name', 255).notNullable();
    // PEM-encoded Ed25519 public key. Nullable — unsigned modules are permitted.
    table.text('public_key').nullable();
    // Array of transaction type codes this module is authorised to post.
    table.specificType('allowed_transaction_types', 'TEXT[]').notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('registered_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // webhook_subscriptions — callback endpoints registered by external services.
  await knex.schema.createTable('webhook_subscriptions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('callback_url').notNullable();
    table.specificType('event_types', 'TEXT[]').notNullable();
    table.string('secret', 255).notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_delivery_at', { useTz: true }).nullable();
    table.integer('failure_count').notNullable().defaultTo(0);
  });

  // webhook_deliveries — per-event delivery log with retry state.
  await knex.schema.createTable('webhook_deliveries', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('subscription_id')
      .notNullable()
      .references('id')
      .inTable('webhook_subscriptions')
      .onDelete('CASCADE');
    table.string('event_type', 100).notNullable();
    table.jsonb('payload').notNullable();
    // PENDING, DELIVERED, FAILED, RETRYING
    table.string('status', 20).notNullable();
    table.integer('attempts').notNullable().defaultTo(0);
    table.timestamp('last_attempt_at', { useTz: true }).nullable();
    table.integer('last_response_status').nullable();
    table.text('last_error').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['status', 'created_at'], 'idx_webhook_deliveries_status');
  });

  // approval_delegations — temporary delegation of approval authority.
  await knex.schema.createTable('approval_delegations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('delegator_id', 255).notNullable();
    table.string('delegate_id', 255).notNullable();
    table.timestamp('valid_from', { useTz: true }).notNullable();
    table.timestamp('valid_until', { useTz: true }).notNullable();
    // Optional scope: { transaction_types?, max_amount? }
    table.jsonb('scope').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // exchange_rates — historical FX rates for base-currency conversion.
  await knex.schema.createTable('exchange_rates', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('from_currency', 3).notNullable();
    table.string('to_currency', 3).notNullable();
    table.decimal('rate', 19, 8).notNullable();
    table.date('effective_date').notNullable();
    // e.g. 'manual', 'ecb', 'openexchangerates'
    table.string('source', 100).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['from_currency', 'to_currency', 'effective_date']);
    // Descending on effective_date so "most recent on or before date" queries use the index.
    table.index(
      ['from_currency', 'to_currency', 'effective_date'],
      'idx_exchange_rates_lookup'
    );
  });

  // sub_ledger_reconciliations — period-end confirmation from each module.
  await knex.schema.createTable('sub_ledger_reconciliations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('period_id', 10).notNullable();
    table.string('module_id', 100).notNullable();
    table.string('control_account', 20).notNullable();
    table.decimal('module_balance', 19, 4).notNullable();
    table.decimal('gl_balance', 19, 4).notNullable();
    table.boolean('is_reconciled').notNullable();
    table.timestamp('confirmed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.text('notes').nullable();
  });

  // Performance indexes on pre-existing transactions table.
  await knex.schema.alterTable('transactions', (table) => {
    table.index(['period_id'], 'idx_transactions_period');
    table.index(['date'], 'idx_transactions_date');
    table.index(['transaction_type'], 'idx_transactions_type');
    table.index(['counterparty_trading_account_id'], 'idx_transactions_counterparty');
    table.index(['correlation_id'], 'idx_transactions_correlation');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Remove indexes added to transactions.
  await knex.schema.alterTable('transactions', (table) => {
    table.dropIndex([], 'idx_transactions_correlation');
    table.dropIndex([], 'idx_transactions_counterparty');
    table.dropIndex([], 'idx_transactions_type');
    table.dropIndex([], 'idx_transactions_date');
    table.dropIndex([], 'idx_transactions_period');
  });

  await knex.schema.dropTable('sub_ledger_reconciliations');
  await knex.schema.dropTable('exchange_rates');
  await knex.schema.dropTable('approval_delegations');
  await knex.schema.dropTable('webhook_deliveries');
  await knex.schema.dropTable('webhook_subscriptions');
  await knex.schema.dropTable('registered_modules');
  await knex.schema.dropTable('company_settings');
}
