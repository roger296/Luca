import type { Request, Response, NextFunction } from "express";
import * as exchangeRatesDb from "../db/queries/exchange_rates";

export async function setExchangeRate(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  try {
    const { from_currency, to_currency, rate, effective_date, source } = req.body as Record<string, string>;
    if (!from_currency || !to_currency || !rate || !effective_date) {
      res.status(400).json({ success: false, error: {
        code: "VALIDATION_ERROR",
        message: "from_currency, to_currency, rate, effective_date are required",
      } });
      return;
    }
    const result = await exchangeRatesDb.setRate(
      from_currency, to_currency, String(rate), effective_date, source
    );
    res.status(200).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function listExchangeRates(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  try {
    const { from_currency, to_currency, date } = req.query as Record<string, string | undefined>;
    const rates = await exchangeRatesDb.getRates({
      fromCurrency: from_currency,
      toCurrency: to_currency,
      date,
    });
    res.json({ success: true, data: rates });
  } catch (err) { next(err); }
}
