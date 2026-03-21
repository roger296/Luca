import { knex } from "../connection";
import type { RegisteredModule } from "../../engine/types";

/** Fetch a single module record, or null if not found. */
export async function getModule(
  moduleId: string
): Promise<RegisteredModule | null> {
  const row = await knex("registered_modules")
    .where({ module_id: moduleId })
    .first();
  return (row as RegisteredModule) ?? null;
}

/** List all registered modules. */
export async function listModules(): Promise<RegisteredModule[]> {
  const rows = await knex("registered_modules");
  return rows as RegisteredModule[];
}

/**
 * Insert or update a module registration.
 * On conflict (module_id), merges display_name, public_key,
 * allowed_transaction_types, and is_active.
 */
export async function registerModule(
  moduleId: string,
  displayName: string,
  publicKey: string | null,
  allowedTypes: string[]
): Promise<RegisteredModule> {
  const [row] = await knex("registered_modules")
    .insert({
      module_id: moduleId,
      display_name: displayName,
      public_key: publicKey,
      allowed_transaction_types: allowedTypes,
      is_active: true,
    })
    .onConflict(["module_id"])
    .merge(["display_name", "public_key", "allowed_transaction_types", "is_active"])
    .returning("*");
  return row as RegisteredModule;
}

/** Update only the public key for an existing module. */
export async function updateModuleKey(
  moduleId: string,
  publicKey: string
): Promise<void> {
  await knex("registered_modules")
    .where({ module_id: moduleId })
    .update({ public_key: publicKey });
}
