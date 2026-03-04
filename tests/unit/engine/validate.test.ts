import {
  journalLinesToPostingLines,
  validateBalance,
  validateSubmission,
} from '../../../src/engine/validate';
import type { JournalLine, TransactionSubmission } from '../../../src/engine/types';
import { ValidationError } from '../../../src/engine/types';

// ---------------------------------------------------------------------------
// validateSubmission
// ---------------------------------------------------------------------------

describe('validateSubmission', () => {
  const baseManual: TransactionSubmission = {
    transaction_type: 'MANUAL_JOURNAL',
    date: '2026-03-15',
    period_id: '2026-03',
    lines: [
      { account_code: '1000', debit: 100, credit: 0 },
      { account_code: '4000', debit: 0, credit: 100 },
    ],
  };

  const baseInvoice: TransactionSubmission = {
    transaction_type: 'CUSTOMER_INVOICE',
    date: '2026-03-15',
    period_id: '2026-03',
    amount: 1200,
  };

  it('accepts a valid MANUAL_JOURNAL submission', () => {
    expect(() => validateSubmission(baseManual)).not.toThrow();
  });

  it('accepts a valid CUSTOMER_INVOICE submission', () => {
    expect(() => validateSubmission(baseInvoice)).not.toThrow();
  });

  it('accepts a valid PRIOR_PERIOD_ADJUSTMENT submission', () => {
    expect(() =>
      validateSubmission({
        transaction_type: 'PRIOR_PERIOD_ADJUSTMENT',
        date: '2026-04-01',
        period_id: '2026-04',
        lines: [
          { account_code: '1000', debit: 50, credit: 0 },
          { account_code: '4000', debit: 0, credit: 50 },
        ],
        adjustment_context: {
          original_period: '2026-03',
          reason: 'Correction',
          authorised_by: 'controller@company.com',
        },
      }),
    ).not.toThrow();
  });

  it('throws ValidationError for invalid date format', () => {
    expect(() => validateSubmission({ ...baseManual, date: '15-03-2026' })).toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError for invalid period_id format', () => {
    expect(() => validateSubmission({ ...baseManual, period_id: '2026/03' })).toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError when MANUAL_JOURNAL has no lines', () => {
    expect(() => validateSubmission({ ...baseManual, lines: [] })).toThrow(ValidationError);
  });

  it('throws ValidationError when MANUAL_JOURNAL is given an amount', () => {
    expect(() => validateSubmission({ ...baseManual, amount: 100 })).toThrow(ValidationError);
  });

  it('throws ValidationError when PRIOR_PERIOD_ADJUSTMENT is missing adjustment_context', () => {
    expect(() =>
      validateSubmission({
        transaction_type: 'PRIOR_PERIOD_ADJUSTMENT',
        date: '2026-04-01',
        period_id: '2026-04',
        lines: [
          { account_code: '1000', debit: 50, credit: 0 },
          { account_code: '4000', debit: 0, credit: 50 },
        ],
      }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError when CUSTOMER_INVOICE has no amount', () => {
    expect(() =>
      validateSubmission({ ...baseInvoice, amount: undefined }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError when CUSTOMER_INVOICE amount is zero', () => {
    expect(() => validateSubmission({ ...baseInvoice, amount: 0 })).toThrow(ValidationError);
  });

  it('throws ValidationError when CUSTOMER_INVOICE amount is negative', () => {
    expect(() => validateSubmission({ ...baseInvoice, amount: -100 })).toThrow(ValidationError);
  });

  it('throws ValidationError when CUSTOMER_INVOICE is given explicit lines', () => {
    expect(() =>
      validateSubmission({
        ...baseInvoice,
        lines: [{ account_code: '1100', debit: 1200, credit: 0 }],
      }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for an unknown transaction type', () => {
    expect(() =>
      validateSubmission({
        ...baseInvoice,
        // @ts-expect-error testing invalid type
        transaction_type: 'UNKNOWN_TYPE',
      }),
    ).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// validateBalance
// ---------------------------------------------------------------------------

describe('validateBalance', () => {
  it('passes when debits equal credits', () => {
    expect(() =>
      validateBalance([
        { account_code: '1000', description: '', debit: 500, credit: 0 },
        { account_code: '4000', description: '', debit: 0, credit: 500 },
      ]),
    ).not.toThrow();
  });

  it('passes for a multi-line balanced transaction', () => {
    expect(() =>
      validateBalance([
        { account_code: '1100', description: '', debit: 1200, credit: 0 },
        { account_code: '4000', description: '', debit: 0, credit: 1000 },
        { account_code: '2100', description: '', debit: 0, credit: 200 },
      ]),
    ).not.toThrow();
  });

  it('throws ValidationError when debits do not equal credits', () => {
    expect(() =>
      validateBalance([
        { account_code: '1000', description: '', debit: 500, credit: 0 },
        { account_code: '4000', description: '', debit: 0, credit: 400 },
      ]),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for empty lines', () => {
    expect(() => validateBalance([])).toThrow(ValidationError);
  });

  it('throws ValidationError when a line has both debit and credit set', () => {
    expect(() =>
      validateBalance([
        { account_code: '1000', description: '', debit: 100, credit: 100 },
        { account_code: '4000', description: '', debit: 0, credit: 0 },
      ]),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError when a line has both debit and credit zero', () => {
    expect(() =>
      validateBalance([
        { account_code: '1000', description: '', debit: 100, credit: 0 },
        { account_code: '4000', description: '', debit: 0, credit: 0 },
      ]),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for negative debit', () => {
    expect(() =>
      validateBalance([
        { account_code: '1000', description: '', debit: -100, credit: 0 },
        { account_code: '4000', description: '', debit: 0, credit: -100 },
      ]),
    ).toThrow(ValidationError);
  });

  it('handles floating point amounts without false imbalance', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in plain JS — Decimal.js handles this correctly.
    expect(() =>
      validateBalance([
        { account_code: '1000', description: '', debit: 0.1, credit: 0 },
        { account_code: '1000', description: '', debit: 0.2, credit: 0 },
        { account_code: '4000', description: '', debit: 0, credit: 0.3 },
      ]),
    ).not.toThrow();
  });

  it('error message includes debit and credit totals', () => {
    expect(() =>
      validateBalance([
        { account_code: '1000', description: '', debit: 600, credit: 0 },
        { account_code: '4000', description: '', debit: 0, credit: 500 },
      ]),
    ).toThrow(/600\.00.*500\.00/);
  });
});

// ---------------------------------------------------------------------------
// journalLinesToPostingLines
// ---------------------------------------------------------------------------

describe('journalLinesToPostingLines', () => {
  const lines: JournalLine[] = [
    { account_code: '1000', debit: 100, credit: 0, description: 'Bank', cost_centre: 'HQ' },
    { account_code: '4000', debit: 0, credit: 100 },
  ];

  it('converts JournalLines to PostingLines', () => {
    const result = journalLinesToPostingLines(lines);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      account_code: '1000',
      description: 'Bank',
      debit: 100,
      credit: 0,
      cost_centre: 'HQ',
    });
  });

  it('uses empty string description when none provided', () => {
    const result = journalLinesToPostingLines(lines);
    expect(result[1]?.description).toBe('');
  });

  it('trims whitespace from account_code', () => {
    const result = journalLinesToPostingLines([{ account_code: '  1000  ', debit: 1, credit: 0 }]);
    expect(result[0]?.account_code).toBe('1000');
  });

  it('throws ValidationError for missing account_code', () => {
    expect(() =>
      journalLinesToPostingLines([{ account_code: '', debit: 100, credit: 0 }]),
    ).toThrow(ValidationError);
  });
});
