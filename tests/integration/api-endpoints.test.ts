import { knex } from '../../src/db/connection';
import { setupTestTenant, cleanupTestTenant, closeKnex } from './helpers';
import { postTransaction } from '../../src/engine/posting';
import { softClosePeriod, hardClosePeriod } from '../../src/engine/periods';
import { verifyChain, getCheckpoint, getMerkleProof } from '../../src/chain/reader';
import { verifyProof } from '../../src/chain/merkle';
import { getAccountLedgerLines } from '../../src/db/queries/reports';
import * as fsMod from 'fs';
import * as path from 'path';

const CHAINS_DIR = path.join(process.cwd(), 'chains');

const BASE_INVOICE = {
  transaction_type: 'CUSTOMER_INVOICE',
  reference: 'TEST-REF',
  date: '2026-03-10',
  lines: [{ description: 'Test sale', net_amount: '100.0000', tax_amount: '0.0000' }],
  source: { module_id: 'test-module' },
};

function cleanChainFiles() {
  if (fsMod.existsSync(CHAINS_DIR)) {
    for (const f of fsMod.readdirSync(CHAINS_DIR)) {
      if (!f.endsWith('.chain.jsonl')) continue;
      const fp = path.join(CHAINS_DIR, f);
      try { fsMod.chmodSync(fp, 0o644); } catch (_e) { void 0; }
      try { fsMod.unlinkSync(fp); } catch (_e) { void 0; }
    }
  }
}

beforeAll(async () => {
  await setupTestTenant();
  await knex("periods")
    .where({ period_id: "2026-03" })
    .update({ status: "OPEN", data_flag: "PROVISIONAL", closing_hash: null, merkle_root: null });
  await knex("periods").whereNot("period_id", "2026-03").delete();
  cleanChainFiles();
});

afterEach(async () => {
  await cleanupTestTenant();
  await setupTestTenant();
  await knex('periods')
    .where({ period_id: '2026-03' })
    .update({ status: 'OPEN', data_flag: 'PROVISIONAL', closing_hash: null, merkle_root: null });
  await knex('periods').whereNot('period_id', '2026-03').delete();
  cleanChainFiles();
});

afterAll(async () => {
  await closeKnex();
});

// Chain verification tests
describe('Chain verification', () => {
  it('returns valid=true for a chain with one posted transaction', async () => {
    await postTransaction(BASE_INVOICE);
    const result = verifyChain('2026-03');
    expect(result.valid).toBe(true);
    expect(result.entries).toBeGreaterThanOrEqual(2);
  });

  it('returns valid=false after tampering with the chain file', async () => {
    await postTransaction(BASE_INVOICE);
    const chainFile = path.join(CHAINS_DIR, '2026-03.chain.jsonl');
    const buf = Buffer.from(fsMod.readFileSync(chainFile));
    const firstNewline = buf.indexOf(10);
    if (firstNewline > 0 && firstNewline + 30 < buf.length) {
      buf[firstNewline + 20] = buf[firstNewline + 20] === 88 ? 89 : 88;
    }
    fsMod.writeFileSync(chainFile, buf);
    const result = verifyChain('2026-03');
    expect(result.valid).toBe(false);
  });
});

// Chain checkpoint tests
describe('Chain checkpoint', () => {
  it('returns null when no chain file exists for open period', () => {
    const cp = getCheckpoint('2026-03');
    expect(cp).toBeNull();
  });

  it('returns checkpoint data after hard close', async () => {
    await postTransaction(BASE_INVOICE);
    await softClosePeriod('2026-03');
    await hardClosePeriod('2026-03', 'tester');
    const cp = getCheckpoint('2026-03');
    expect(cp).not.toBeNull();
    expect(cp!.closing_hash).toBeTruthy();
    expect(cp!.merkle_root).toBeTruthy();
  });
});

// Merkle proof tests
describe('Merkle proof', () => {
  it('generates a verifiable proof for a transaction in a closed period', async () => {
    const result = await postTransaction(BASE_INVOICE);
    expect(result.status).toBe('POSTED');
    expect(result.chain_sequence).toBeTruthy();
    await softClosePeriod('2026-03');
    await hardClosePeriod('2026-03', 'tester');
    const proof = getMerkleProof('2026-03', result.chain_sequence!);
    const valid = verifyProof(proof);
    expect(valid).toBe(true);
  });
});

// Transaction type discovery tests
describe('Transaction type discovery', () => {
  it('returns at least the standard transaction types', async () => {
    const types = await knex('transaction_type_mappings')
      .where({ is_active: true })
      .select('transaction_type');
    const codes = types.map((t: Record<string, unknown>) => t['transaction_type'] as string);
    expect(codes).toContain('CUSTOMER_INVOICE');
    expect(codes).toContain('MANUAL_JOURNAL');
    expect(codes.length).toBeGreaterThanOrEqual(2);
  });

  it('CUSTOMER_INVOICE mapping has a debit rule for account 1100', async () => {
    const row = await knex('transaction_type_mappings')
      .where({ transaction_type: 'CUSTOMER_INVOICE', is_active: true })
      .first();
    expect(row).toBeTruthy();
    const debitRules = typeof row.debit_rules === 'string'
      ? JSON.parse(row.debit_rules as string)
      : row.debit_rules;
    const has1100 = (debitRules as Array<Record<string, unknown>>).some(
      (r) => r['account_code'] === '1100'
    );
    expect(has1100).toBe(true);
  });
});

// Sub-ledger reconciliation tests
describe('Sub-ledger reconciliation', () => {
  it('can insert and retrieve a reconciliation record', async () => {
    await knex('sub_ledger_reconciliations').insert({
      period_id: '2026-03',
      module_id: 'test-module',
      control_account: '1100',
      module_balance: '1000.0000',
      gl_balance: '1000.0000',
      is_reconciled: true,
      notes: null,
    });
    const rows = await knex('sub_ledger_reconciliations')
      .where({ period_id: '2026-03' })
      .select('*');
    expect(rows).toHaveLength(1);
    expect((rows[0] as Record<string, unknown>)['module_id']).toBe('test-module');
    expect((rows[0] as Record<string, unknown>)['is_reconciled']).toBe(true);
  });

  it('can insert multiple reconciliations for different modules', async () => {
    await knex('sub_ledger_reconciliations').insert([
      { period_id: '2026-03', module_id: 'module-a',
        control_account: '1100', module_balance: '500.0000', gl_balance: '500.0000',
        is_reconciled: true, notes: null },
      { period_id: '2026-03', module_id: 'module-b',
        control_account: '2000', module_balance: '300.0000', gl_balance: '300.0000',
        is_reconciled: true, notes: null },
    ]);
    const rows = await knex('sub_ledger_reconciliations')
      .where({ period_id: '2026-03' })
      .select('*');
    expect(rows).toHaveLength(2);
  });
});

// Account ledger running balance tests
describe('Account ledger running balance', () => {
  it('running_net increases cumulatively with each transaction', async () => {
    await postTransaction({
      ...BASE_INVOICE,
      reference: 'REF-1',
      lines: [{ description: 'Sale 1', net_amount: '100.0000', tax_amount: '0.0000' }],
    });
    await postTransaction({
      ...BASE_INVOICE,
      reference: 'REF-2',
      lines: [{ description: 'Sale 2', net_amount: '200.0000', tax_amount: '0.0000' }],
    });
    const result = await getAccountLedgerLines('1100', { page: 1, page_size: 100 });
    expect(result.data.length).toBeGreaterThanOrEqual(2);
    const nets = result.data.map((r) => parseFloat(r.running_net));
    for (let i = 1; i < nets.length; i++) {
      expect(nets[i]).toBeGreaterThanOrEqual(nets[i - 1]);
    }
    for (const row of result.data) {
      expect(row.category).toBeTruthy();
    }
  });

  it('running balance carries across pagination pages', async () => {
    for (let i = 1; i <= 5; i++) {
      await postTransaction({
        ...BASE_INVOICE,
        reference: 'PAGE-' + String(i),
        lines: [{ description: 'Line ' + String(i), net_amount: '50.0000', tax_amount: '0.0000' }],
      });
    }
    const page1 = await getAccountLedgerLines('1100', { page: 1, page_size: 3 });
    const page2 = await getAccountLedgerLines('1100', { page: 2, page_size: 3 });
    expect(page1.data.length).toBe(3);
    if (page2.data.length > 0) {
      const lastP1 = parseFloat(page1.data[page1.data.length - 1].running_net);
      const firstP2 = parseFloat(page2.data[0].running_net);
      expect(firstP2).toBeGreaterThan(lastP1);
    }
  });
});
