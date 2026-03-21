import { knex } from "../connection";

export interface ExchangeRate {
  id: string;
  from_currency: string;
  to_currency: string;
  rate: string;
  effective_date: string;
  source: string | null;
  created_at: string;
}

/** Insert or update an exchange rate for a given date. */
export async function setRate(
  fromCurrency: string,
  toCurrency: string,
  rate: string,
  effectiveDate: string,
  source?: string
): Promise<ExchangeRate> {
  const [row] = await knex("exchange_rates")
    .insert({
      from_currency: fromCurrency.toUpperCase(),
      to_currency: toCurrency.toUpperCase(),
      rate,
      effective_date: effectiveDate,
      source: source ?? "manual",
    })
    .onConflict(["from_currency", "to_currency", "effective_date"])
    .merge(["rate", "source"])
    .returning("*");
  return row as ExchangeRate;
}

/** Most recent rate on or before the given date. Returns null if no rate found. */
export async function getRate(
  fromCurrency: string,
  toCurrency: string,
  date: string
): Promise<string | null> {
  if (fromCurrency.toUpperCase() === toCurrency.toUpperCase()) return "1";
  const row = await knex("exchange_rates")
    .where("from_currency", fromCurrency.toUpperCase())
    .where("to_currency", toCurrency.toUpperCase())
    .where("effective_date", "<=", date)
    .orderBy("effective_date", "desc")
    .select("rate")
    .first();
  return row ? String((row as Record<string, unknown>)["rate"]) : null;
}

/**
 * List rates, optionally filtered. Returns the most recent rate per
 * (from, to) pair when a date is supplied.
 */
export async function getRates(
  opts?: { fromCurrency?: string; toCurrency?: string; date?: string }
): Promise<ExchangeRate[]> {
  const query = knex("exchange_rates");
  if (opts?.fromCurrency) query.where("from_currency", opts.fromCurrency.toUpperCase());
  if (opts?.toCurrency) query.where("to_currency", opts.toCurrency.toUpperCase());
  if (opts?.date) query.where("effective_date", "<=", opts.date);
  const rows = await query.orderBy("effective_date", "desc");
  if (!opts?.date) return rows as ExchangeRate[];
  // De-duplicate: keep most recent per (from, to) pair
  const seen = new Set<string>();
  const result: ExchangeRate[] = [];
  for (const row of rows) {
    const r = row as ExchangeRate;
    const key = r.from_currency + "/" + r.to_currency;
    if (!seen.has(key)) { seen.add(key); result.push(r); }
  }
  return result;
}
