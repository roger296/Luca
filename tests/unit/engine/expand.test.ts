import Decimal from 'decimal.js';
import { expandToPostingLines, splitGrossAmount } from '../../../src/engine/expand';
import type { MappingRow, TransactionSubmission } from '../../../src/engine/types';

// ---------------------------------------------------------------------------
// splitGrossAmount
// ---------------------------------------------------------------------------

describe('splitGrossAmount', () => {
  it('correctly splits a standard gross amount (20% VAT)', () => {
    const { net, vat } = splitGrossAmount(new Decimal('1200'));
    expect(net.toFixed(2)).toBe('1000.00');
    expect(vat.toFixed(2)).toBe('200.00');
  });

  it('net + vat equals the original gross', () => {
    const gross = new Decimal('555.50');
    const { net, vat } = splitGrossAmount(gross);
    expect(net.plus(vat).toFixed(2)).toBe(gross.toFixed(2));
  });

  it('rounds to 2 decimal places correctly', () => {
    // Gross £100 → net £83.33, vat £16.67
    const { net, vat } = splitGrossAmount(new Decimal('100'));
    expect(net.toFixed(2)).toBe('83.33');
    expect(vat.toFixed(2)).toBe('16.67');
  });

  it('handles round amounts with no pence', () => {
    const { net, vat } = splitGrossAmount(new Decimal('60'));
    expect(net.toFixed(2)).toBe('50.00');
    expect(vat.toFixed(2)).toBe('10.00');
  });
});

// ---------------------------------------------------------------------------
// expandToPostingLines — CUSTOMER_INVOICE
// ---------------------------------------------------------------------------

describe('expandToPostingLines — CUSTOMER_INVOICE', () => {
  const customerInvoiceMappings: MappingRow[] = [
    { transaction_type: 'CUSTOMER_INVOICE', line_role: 'DEBTORS', account_code: '1100', direction: 'DEBIT', description: 'Trade debtors' },
    { transaction_type: 'CUSTOMER_INVOICE', line_role: 'REVENUE', account_code: '4000', direction: 'CREDIT', description: 'Sales revenue' },
    { transaction_type: 'CUSTOMER_INVOICE', line_role: 'VAT_OUTPUT', account_code: '2100', direction: 'CREDIT', description: 'VAT output' },
  ];

  const submission: TransactionSubmission = {
    transaction_type: 'CUSTOMER_INVOICE',
    date: '2026-03-15',
    period_id: '2026-03',
    amount: 1200,
  };

  it('produces 3 posting lines', () => {
    const lines = expandToPostingLines(submission, customerInvoiceMappings);
    expect(lines).toHaveLength(3);
  });

  it('DEBTORS line = gross amount (1200)', () => {
    const lines = expandToPostingLines(submission, customerInvoiceMappings);
    const debtors = lines.find((l) => l.account_code === '1100');
    expect(debtors?.debit).toBe(1200);
    expect(debtors?.credit).toBe(0);
  });

  it('REVENUE line = net amount (1000)', () => {
    const lines = expandToPostingLines(submission, customerInvoiceMappings);
    const revenue = lines.find((l) => l.account_code === '4000');
    expect(revenue?.credit).toBe(1000);
    expect(revenue?.debit).toBe(0);
  });

  it('VAT_OUTPUT line = VAT amount (200)', () => {
    const lines = expandToPostingLines(submission, customerInvoiceMappings);
    const vat = lines.find((l) => l.account_code === '2100');
    expect(vat?.credit).toBe(200);
    expect(vat?.debit).toBe(0);
  });

  it('expanded lines balance (debits = credits)', () => {
    const lines = expandToPostingLines(submission, customerInvoiceMappings);
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });
});

// ---------------------------------------------------------------------------
// expandToPostingLines — SUPPLIER_INVOICE
// ---------------------------------------------------------------------------

describe('expandToPostingLines — SUPPLIER_INVOICE', () => {
  const supplierInvoiceMappings: MappingRow[] = [
    { transaction_type: 'SUPPLIER_INVOICE', line_role: 'EXPENSE', account_code: '5000', direction: 'DEBIT', description: 'COGS' },
    { transaction_type: 'SUPPLIER_INVOICE', line_role: 'VAT_INPUT', account_code: '1200', direction: 'DEBIT', description: 'VAT input' },
    { transaction_type: 'SUPPLIER_INVOICE', line_role: 'CREDITORS', account_code: '2000', direction: 'CREDIT', description: 'Trade creditors' },
  ];

  const submission: TransactionSubmission = {
    transaction_type: 'SUPPLIER_INVOICE',
    date: '2026-03-15',
    period_id: '2026-03',
    amount: 600,
  };

  it('CREDITORS line = gross (600)', () => {
    const lines = expandToPostingLines(submission, supplierInvoiceMappings);
    const creditors = lines.find((l) => l.account_code === '2000');
    expect(creditors?.credit).toBe(600);
  });

  it('EXPENSE line = net (500)', () => {
    const lines = expandToPostingLines(submission, supplierInvoiceMappings);
    const expense = lines.find((l) => l.account_code === '5000');
    expect(expense?.debit).toBe(500);
  });

  it('VAT_INPUT line = VAT (100)', () => {
    const lines = expandToPostingLines(submission, supplierInvoiceMappings);
    const vat = lines.find((l) => l.account_code === '1200');
    expect(vat?.debit).toBe(100);
  });

  it('expanded lines balance', () => {
    const lines = expandToPostingLines(submission, supplierInvoiceMappings);
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    expect(new Decimal(totalDebit).toFixed(2)).toBe(new Decimal(totalCredit).toFixed(2));
  });
});

// ---------------------------------------------------------------------------
// expandToPostingLines — CUSTOMER_PAYMENT
// ---------------------------------------------------------------------------

describe('expandToPostingLines — CUSTOMER_PAYMENT', () => {
  const paymentMappings: MappingRow[] = [
    { transaction_type: 'CUSTOMER_PAYMENT', line_role: 'BANK', account_code: '1000', direction: 'DEBIT', description: 'Bank' },
    { transaction_type: 'CUSTOMER_PAYMENT', line_role: 'DEBTORS', account_code: '1100', direction: 'CREDIT', description: 'Debtors' },
  ];

  const submission: TransactionSubmission = {
    transaction_type: 'CUSTOMER_PAYMENT',
    date: '2026-03-15',
    period_id: '2026-03',
    amount: 1200,
  };

  it('both lines use the full payment amount', () => {
    const lines = expandToPostingLines(submission, paymentMappings);
    expect(lines.find((l) => l.account_code === '1000')?.debit).toBe(1200);
    expect(lines.find((l) => l.account_code === '1100')?.credit).toBe(1200);
  });

  it('lines balance', () => {
    const lines = expandToPostingLines(submission, paymentMappings);
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });
});
