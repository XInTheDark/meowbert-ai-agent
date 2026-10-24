import { Pool } from "pg";
export const pool = new Pool({ connectionString: process.env.TEST_LOCAL_EXECUTION_DATABASE_URL ?? "postgres://127.0.0.1:1/none", max: 4 });
export const database = {
  pool,
  query: (text: string, params: unknown[] = []) => pool.query(text, params),
  withTransaction: async <T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
};
