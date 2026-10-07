import pg from "pg";
export interface Sql {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
}
export function fromPool(pool: pg.Pool): Database {
  return {
    async query<T>(sql: string, values?: unknown[]) {
      const result = await pool.query(sql, values);
      return { rows: result.rows as T[] };
    },
    async transaction<T>(fn: (sql: Sql) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await fn(client);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
const globalDb = globalThis as unknown as { governancePool?: pg.Pool };
export function getPool() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL 환경 변수가 필요합니다.");
  return (globalDb.governancePool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 8,
    connectionTimeoutMillis: 5000,
  }));
}
export function getDatabase() {
  return fromPool(getPool());
}
// A session lock enforces exactly one LanceDB writer across worker/rebuild processes.
export async function withWorkerLock<T>(fn: () => Promise<T>) {
  const client = await getPool().connect();
  let locked = false;
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock(782419301) AS locked",
    );
    locked = result.rows[0].locked;
    if (!locked)
      throw new Error(
        "다른 worker 또는 재인덱싱 명령이 실행 중입니다. 먼저 종료하세요.",
      );
    return await fn();
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(782419301)");
    client.release();
  }
}
