import type { Knex } from 'knex';

interface MappingRow {
  transaction_type: string;
  line_role: string;
  account_code: string;
  direction: 'DEBIT' | 'CREDIT';
  description: string;
}

// Default account mappings for each transaction type that auto-expands into
// double-entry lines. MANUAL_JOURNAL and PRIOR_PERIOD_ADJUSTMENT are not listed
// here because their lines are provided explicitly by the caller.
//
// VAT is assumed at the standard UK rate (20%). The posting engine computes
// the VAT amount from the net value and uses these mappings for the account codes.
const mappings: MappingRow[] = [
  // -----------------------------------------------------------------------
  // CUSTOMER_INVOICE
  //   Debit:  Trade Debtors (gross invoice amount including VAT)
  //   Credit: Sales Revenue — Trade (net amount)
  //   Credit: VAT Output (VAT amount)
  // -----------------------------------------------------------------------
  {
    transaction_type: 'CUSTOMER_INVOICE',
    line_role: 'DEBTORS',
    account_code: '1100',
    direction: 'DEBIT',
    description: 'Trade debtors — customer invoice',
  },
  {
    transaction_type: 'CUSTOMER_INVOICE',
    line_role: 'REVENUE',
    account_code: '4000',
    direction: 'CREDIT',
    description: 'Sales revenue — trade',
  },
  {
    transaction_type: 'CUSTOMER_INVOICE',
    line_role: 'VAT_OUTPUT',
    account_code: '2100',
    direction: 'CREDIT',
    description: 'VAT output tax',
  },

  // -----------------------------------------------------------------------
  // SUPPLIER_INVOICE
  //   Debit:  Cost of Goods Sold / Purchases (net amount)
  //   Debit:  VAT Input (VAT amount)
  //   Credit: Trade Creditors (gross amount including VAT)
  // -----------------------------------------------------------------------
  {
    transaction_type: 'SUPPLIER_INVOICE',
    line_role: 'EXPENSE',
    account_code: '5000',
    direction: 'DEBIT',
    description: 'Cost of goods sold — supplier invoice',
  },
  {
    transaction_type: 'SUPPLIER_INVOICE',
    line_role: 'VAT_INPUT',
    account_code: '1200',
    direction: 'DEBIT',
    description: 'VAT input tax (recoverable)',
  },
  {
    transaction_type: 'SUPPLIER_INVOICE',
    line_role: 'CREDITORS',
    account_code: '2000',
    direction: 'CREDIT',
    description: 'Trade creditors — supplier invoice',
  },

  // -----------------------------------------------------------------------
  // CUSTOMER_PAYMENT
  //   Debit:  Bank Current Account
  //   Credit: Trade Debtors
  // -----------------------------------------------------------------------
  {
    transaction_type: 'CUSTOMER_PAYMENT',
    line_role: 'BANK',
    account_code: '1000',
    direction: 'DEBIT',
    description: 'Bank — customer payment received',
  },
  {
    transaction_type: 'CUSTOMER_PAYMENT',
    line_role: 'DEBTORS',
    account_code: '1100',
    direction: 'CREDIT',
    description: 'Trade debtors — payment applied',
  },

  // -----------------------------------------------------------------------
  // SUPPLIER_PAYMENT
  //   Debit:  Trade Creditors
  //   Credit: Bank Current Account
  // -----------------------------------------------------------------------
  {
    transaction_type: 'SUPPLIER_PAYMENT',
    line_role: 'CREDITORS',
    account_code: '2000',
    direction: 'DEBIT',
    description: 'Trade creditors — payment made',
  },
  {
    transaction_type: 'SUPPLIER_PAYMENT',
    line_role: 'BANK',
    account_code: '1000',
    direction: 'CREDIT',
    description: 'Bank — supplier payment made',
  },
];

export async function seed(knex: Knex): Promise<void> {
  await knex('transaction_type_mappings').del();
  await knex('transaction_type_mappings').insert(mappings);
}
