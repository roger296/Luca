# Chart of Accounts — Quick Reference

This file contains the full chart of accounts for the General Ledger. Use it to look up the
correct account code when posting transactions.

## Assets (1xxx)

| Code | Name | Category | Use For |
|------|------|----------|---------|
| 1000 | Bank Current Account | CURRENT_ASSET | Main bank account — payments and receipts |
| 1050 | Bank Deposit Account | CURRENT_ASSET | Savings / deposit account |
| 1100 | Trade Debtors | CURRENT_ASSET | Amounts owed BY customers (auto-posted by CUSTOMER_INVOICE) |
| 1150 | Other Debtors | CURRENT_ASSET | Non-trade amounts owed to the company |
| 1200 | VAT Input Recoverable | CURRENT_ASSET | VAT paid on purchases (reclaimable from HMRC) |
| 1300 | Stock | CURRENT_ASSET | Inventory / goods held for resale |
| 1350 | Goods Received Not Invoiced | CURRENT_ASSET | Goods received but invoice not yet arrived |
| 1400 | Prepayments | CURRENT_ASSET | Expenses paid in advance (e.g., annual insurance) |
| 1500 | Fixed Assets Cost | FIXED_ASSET | Capital equipment, vehicles, furniture (cost) |
| 1510 | Fixed Assets Accum Depn | FIXED_ASSET | Accumulated depreciation (credit balance) |

## Liabilities (2xxx)

| Code | Name | Category | Use For |
|------|------|----------|---------|
| 2000 | Trade Creditors | CURRENT_LIABILITY | Amounts owed TO suppliers (auto-posted by SUPPLIER_INVOICE) |
| 2050 | Other Creditors | CURRENT_LIABILITY | Non-trade amounts the company owes |
| 2100 | VAT Output | CURRENT_LIABILITY | VAT charged on sales (owed to HMRC) |
| 2150 | Accruals | CURRENT_LIABILITY | Expenses incurred but not yet invoiced |
| 2200 | PAYE/NI Payable | CURRENT_LIABILITY | Payroll taxes owed to HMRC |

## Equity (3xxx)

| Code | Name | Category | Use For |
|------|------|----------|---------|
| 3000 | Share Capital | EQUITY | Initial capital invested by shareholders |
| 3100 | Retained Earnings | EQUITY | Accumulated profits carried forward |
| 3200 | Revaluation Reserve | EQUITY | Asset revaluation adjustments |

## Revenue (4xxx)

| Code | Name | Category | Use For |
|------|------|----------|---------|
| 4000 | Sales Revenue Trade | REVENUE | Core product/service sales |
| 4100 | Sales Revenue Other | REVENUE | Secondary or occasional sales |
| 4200 | Other Income | OTHER_INCOME | Miscellaneous income, scrap sales, commissions |

## Direct Costs (5xxx)

| Code | Name | Category | Use For |
|------|------|----------|---------|
| 5000 | Cost of Goods Sold | DIRECT_COSTS | Cost of items sold (used in COGS journals) |
| 5100 | Purchases Raw Materials | DIRECT_COSTS | Raw materials, goods for resale, stock purchases |
| 5200 | Purchase Price Variance | DIRECT_COSTS | Differences between standard and actual cost |

## Overheads (6xxx)

| Code | Name | Category | Use For |
|------|------|----------|---------|
| 6000 | Wages and Salaries | OVERHEADS | Staff costs, gross pay, employer NI |
| 6100 | Rent and Rates | OVERHEADS | Office/warehouse rent, business rates, insurance |
| 6200 | Utilities | OVERHEADS | Electricity, gas, water |
| 6300 | Communications | OVERHEADS | Phone, internet, postage, hosting |
| 6400 | Office Supplies | OVERHEADS | Stationery, consumables, small office items |
| 6500 | Travel and Subsistence | OVERHEADS | Flights, hotels, taxis, mileage, meals |
| 6600 | Professional Fees | OVERHEADS | Accountancy, legal, consultancy, audit |
| 6700 | Marketing and Advertising | OVERHEADS | Ads, marketing agency, events, PR |
| 6800 | IT and Software | OVERHEADS | Software subscriptions, IT support, hardware |

## Finance (7xxx)

| Code | Name | Category | Use For |
|------|------|----------|---------|
| 7000 | Bank Interest Received | OTHER_INCOME | Interest earned on bank balances |
| 7100 | Bank Charges | FINANCE_COSTS | Bank fees, card processing charges |
| 7200 | FX Gains/Losses | FINANCE_COSTS | Foreign exchange rate differences |

---

## Transaction Types Reference

These are the transaction types the GL accepts. For most postings, you provide a single
amount and account — the GL generates the double-entry automatically based on the type.

| Transaction Type | You Specify | GL Auto-Posts Contra To |
|---|---|---|
| SUPPLIER_INVOICE | Expense/cost account + amount | 2000 Trade Creditors (CR) |
| SUPPLIER_CREDIT_NOTE | Original expense account + amount | 2000 Trade Creditors (DR) |
| CUSTOMER_INVOICE | Revenue account + amount | 1100 Trade Debtors (DR) |
| CUSTOMER_CREDIT_NOTE | Revenue account + amount | 1100 Trade Debtors (CR) |
| SUPPLIER_PAYMENT | Bank account + amount | 2000 Trade Creditors (DR) |
| CUSTOMER_RECEIPT | Bank account + amount | 1100 Trade Debtors (CR) |
| BANK_PAYMENT | Expense account + amount | 1000 Bank (CR) |
| BANK_RECEIPT | Income account + amount | 1000 Bank (DR) |
| TRANSFER | From-bank + To-bank + amount | (both sides posted) |
| JOURNAL | All lines manually (DR positive, CR negative) | None — you specify everything |

**Note on VAT**: When a transaction includes VAT, include a `vat_amount` field in the line.
The GL will split the posting to route the VAT portion to the appropriate VAT account
(1200 for purchases, 2100 for sales).
