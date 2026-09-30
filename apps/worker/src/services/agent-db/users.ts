import { query } from "../../lib/db.js";

export async function isUserSuperAdmin(userId: string): Promise<boolean> {
  const result = await query<{ is_super_admin: boolean }>(
    `SELECT is_super_admin
       FROM users
      WHERE id = $1`,
    [userId]
  );

  return result.rows[0]?.is_super_admin === true;
}
