import { PGlite } from "@electric-sql/pglite";
import type { Database, Sql } from "../../src/infrastructure/db/connection";
import { migrate } from "../../scripts/migrate";

// PGlite's query() runs one statement; parameterless SQL (migrations) goes through exec().
function adapt(client: Pick<PGlite, "query" | "exec">): Sql {
  return {
    async query<T>(query: string, values?: unknown[]) {
      if (values?.length) return client.query<T>(query, values);
      const results = await client.exec(query);
      return { rows: (results.at(-1)?.rows ?? []) as T[] };
    },
  };
}

export async function createTestDatabase() {
  const pg = new PGlite();
  const db: Database = {
    ...adapt(pg),
    transaction: (fn) => pg.transaction((tx) => fn(adapt(tx))),
  };
  await migrate(db);
  // A second run proves migrations are tracked and skipped.
  await migrate(db);
  return { pg, db };
}
