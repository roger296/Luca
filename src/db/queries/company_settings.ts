import { knex } from "../connection";

export interface CompanySettings {
  id: number;
  company_name: string;
  base_currency: string;
  financial_year_start_month: number;
  created_at: Date;
  updated_at: Date;
  settings: Record<string, unknown>;
}

export interface CompanySettingsUpdate {
  company_name?: string;
  base_currency?: string;
  financial_year_start_month?: number;
  settings?: Record<string, unknown>;
}

// In-memory cache. The company settings row rarely changes, so we cache after first read
// and invalidate only when updateCompanySettings() is called.
let cache: CompanySettings | null = null;

export async function getCompanySettings(): Promise<CompanySettings> {
  if (cache) return cache;

  const row = await knex("company_settings").where({ id: 1 }).first();
  if (!row) {
    throw new Error(
      "Company settings row not found. Run migrations and seed before starting the server."
    );
  }

  cache = row as CompanySettings;
  return cache;
}

export async function updateCompanySettings(
  updates: CompanySettingsUpdate
): Promise<CompanySettings> {
  const payload: Record<string, unknown> = { ...updates, updated_at: new Date() };

  // Serialize settings JSONB if provided.
  if (updates.settings !== undefined) {
    payload.settings = JSON.stringify(updates.settings);
  }

  await knex("company_settings").where({ id: 1 }).update(payload);

  cache = null; // invalidate after update
  return getCompanySettings();
}

// Convenience accessor — avoids callers having to destructure getCompanySettings().
export async function getBaseCurrency(): Promise<string> {
  const settings = await getCompanySettings();
  return settings.base_currency;
}
