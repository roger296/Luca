import type { Request, Response, NextFunction } from "express";
import * as accountsDb from "../db/queries/accounts";
import * as reportsDb from "../db/queries/reports";

// ─── GET /accounts ────────────────────────────────────────────────────────────

export async function listAccounts(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { category, active_only, search } = req.query as Record<string, string | undefined>;

    const activeOnlyBool =
      active_only === "true" ? true : active_only === "false" ? false : undefined;

    const accounts = await accountsDb.listAccounts({
      category,
      active_only: activeOnlyBool,
      search,
    });

    res.json({ success: true, data: accounts });
  } catch (err) {
    next(err);
  }
}

// ─── POST /accounts ───────────────────────────────────────────────────────────

export async function createAccount(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { code, name, category, type, active } = req.body as {
      code: string;
      name: string;
      category: string;
      type?: string;
      active?: boolean;
    };

    if (!code || !name || !category) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "code, name, and category are required" },
      });
      return;
    }

    const account = await accountsDb.createAccount({
      code,
      name,
      category: category as import("../engine/types").AccountCategory,
      type: type ?? null,
      active: active !== false,
    });

    res.status(201).json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
}

// ─── PUT /accounts/:code ──────────────────────────────────────────────────────

export async function updateAccount(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { code } = req.params;
    const { name, active } = req.body as { name?: string; active?: boolean };

    const account = await accountsDb.updateAccount(code, { name, active });

    if (!account) {
      res.status(404).json({
        success: false,
        error: { code: "ACCOUNT_NOT_FOUND", message: `Account ${code} not found` },
      });
      return;
    }

    res.json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
}

// ─── GET /accounts/:code/balance ──────────────────────────────────────────────

export async function getAccountBalance(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { code } = req.params;
    const { period, as_at_date } = req.query as Record<string, string | undefined>;

    // Verify the account exists
    const account = await accountsDb.getAccount(code);
    if (!account) {
      res.status(404).json({
        success: false,
        error: { code: "ACCOUNT_NOT_FOUND", message: `Account ${code} not found` },
      });
      return;
    }

    const balance = await accountsDb.getAccountBalance(code, {
      period_id: period,
      date_to: as_at_date,
    });

    res.json({
      success: true,
      data: {
        account_code: code,
        account_name: account.name,
        category: account.category,
        period: period ?? null,
        as_at_date: as_at_date ?? null,
        debit: balance.debit,
        credit: balance.credit,
        net: balance.net,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /accounts/:code/ledger ───────────────────────────────────────────────

export async function getAccountLedger(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { code } = req.params;
    const { date_from, date_to, period, page, page_size } = req.query as Record<
      string,
      string | undefined
    >;

    // Verify the account exists
    const account = await accountsDb.getAccount(code);
    if (!account) {
      res.status(404).json({
        success: false,
        error: { code: "ACCOUNT_NOT_FOUND", message: `Account ${code} not found` },
      });
      return;
    }

    const { data, total } = await reportsDb.getAccountLedgerLines(code, {
      date_from,
      date_to,
      period_id: period,
      page: page !== undefined ? parseInt(page, 10) : undefined,
      page_size: page_size !== undefined ? parseInt(page_size, 10) : undefined,
    });

    const pageNum = page !== undefined ? Math.max(parseInt(page, 10), 1) : 1;
    const pageSizeNum = page_size !== undefined ? parseInt(page_size, 10) : 50;

    // Running balance sign: debit-normal accounts (ASSET/EXPENSE) show net debit;
    // credit-normal accounts (LIABILITY/EQUITY/REVENUE) show net credit.
    const isDebitNormal = account.category === "ASSET" || account.category === "EXPENSE";
    const entries = data.map((e) => ({
      transaction_id: e.transaction_id,
      date: e.date,
      description: e.description,
      reference: e.reference,
      debit: e.debit,
      credit: e.credit,
      transaction_type: e.transaction_type,
      running_balance: isDebitNormal
        ? e.running_net
        : String((-parseFloat(e.running_net)).toFixed(4)),
    }));

    res.json({
      success: true,
      data: {
        account_code: code,
        account_name: account.name,
        entries,
        pagination: {
          page: pageNum,
          page_size: pageSizeNum,
          total,
          total_pages: Math.ceil(total / pageSizeNum),
        },
      },
    });
  } catch (err) {
    next(err);
  }
}
