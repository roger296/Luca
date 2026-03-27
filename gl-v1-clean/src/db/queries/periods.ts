import { knex } from "../connection";
import type { Period } from "../../engine/types";

export async function getPeriod(periodId: string): Promise<Period | null> {
  const row = await knex("periods")
    .where({ period_id: periodId })
    .first();
  return row ? (row as Period) : null;
}

export async function getCurrentPeriod(): Promise<Period | null> {
  const row = await knex("periods")
    .where({ status: "OPEN" })
    .orderBy("period_id", "desc")
    .first();
  return row ? (row as Period) : null;
}

export async function listPeriods(): Promise<Period[]> {
  const rows = await knex("periods")
    .orderBy("period_id", "desc");
  return rows as Period[];
}

export async function createPeriod(
  data: { period_id: string; status: string; data_flag: string }
): Promise<Period> {
  const [row] = await knex("periods")
    .insert(data)
    .returning("*");
  return row as Period;
}

export async function updatePeriodStatus(
  periodId: string,
  status: string,
  data_flag?: string
): Promise<void> {
  const update: Record<string, string> = { status };
  if (data_flag !== undefined) {
    update.data_flag = data_flag;
  }
  await knex("periods")
    .where({ period_id: periodId })
    .update(update);
}

export async function updatePeriodClosingHash(
  periodId: string,
  closingHash: string,
  merkleRoot: string
): Promise<void> {
  await knex("periods")
    .where({ period_id: periodId })
    .update({
      closing_hash: closingHash,
      merkle_root: merkleRoot,
    });
}

export async function getPreviousPeriod(
  currentPeriodId: string
): Promise<Period | null> {
  const row = await knex("periods")
    .where("period_id", "<", currentPeriodId)
    .orderBy("period_id", "desc")
    .first();
  return row ? (row as Period) : null;
}
