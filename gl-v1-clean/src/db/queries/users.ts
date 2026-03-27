import { knex } from "../connection";

export interface User {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  roles: string[];
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

/** Find a user by email. Returns null if not found. */
export async function findUserByEmail(
  email: string
): Promise<User | null> {
  const user = await knex<User>("users")
    .where({ email })
    .first();
  return user ?? null;
}

/** Find a user by ID. Returns null if not found. */
export async function findUserById(
  userId: string
): Promise<User | null> {
  const user = await knex<User>("users")
    .where({ id: userId })
    .first();
  return user ?? null;
}

/** Record a successful login by updating last_login_at. */
export async function recordLogin(userId: string): Promise<void> {
  await knex("users")
    .where({ id: userId })
    .update({ last_login_at: knex.fn.now() });
}
