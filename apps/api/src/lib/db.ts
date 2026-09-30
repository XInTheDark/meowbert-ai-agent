import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { config } from "./config.js";

export const pool = new Pool({
  connectionString: config.db.url,
  max: 20,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

pool.on("error", (error) => {
  console.error("[db] Unexpected PostgreSQL pool error", error);
});

const TRANSIENT_PG_CODE_PREFIXES = ["08", "57P01", "57P03"];

function isTransientError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  if (!code) return false;
  return TRANSIENT_PG_CODE_PREFIXES.some((prefix) => code.startsWith(prefix));
}

export async function queryWithRetry<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  maxAttempts = 3
): Promise<QueryResult<T>> {
  const delays = [200, 1_000, 3_000];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await pool.query<T>(text, params);
    } catch (error) {
      if (attempt < maxAttempts && isTransientError(error)) {
        const delay = delays[attempt - 1] ?? 3_000;
        console.warn(`[db] Transient error on attempt ${attempt}/${maxAttempts}, retrying in ${delay}ms…`, (error as Error).message);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error("[db] queryWithRetry: unreachable");
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function withConnection<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const onClientError = (error: Error) => {
    console.error("[db] PostgreSQL client error while client is checked out", error);
  };
  client.on("error", onClientError);
  try {
    return await fn(client);
  } finally {
    client.off("error", onClientError);
    client.release();
  }
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withConnection(async (client) => {
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
