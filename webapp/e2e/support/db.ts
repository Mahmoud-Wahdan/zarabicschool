import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env", quiet: true });

/**
 * Read-only checks of side effects the UI does not show (job rows, ledger rows,
 * attempts). Specs never write through this pool; all writes go through the app.
 */
let pool: Pool | null = null;

export async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export async function closeDb() {
  await pool?.end();
  pool = null;
}
