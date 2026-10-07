import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  getDatabase,
  getPool,
  type Database,
} from "../src/infrastructure/db/connection";
export async function migrate(db: Database) {
  await db.transaction(async (sql) => {
    await sql.query("SELECT pg_advisory_xact_lock(782419303)");
    await sql.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (
      await readdir(new URL("../migrations/", import.meta.url))
    )
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const content = await readFile(
        new URL(`../migrations/${name}`, import.meta.url),
        "utf8",
      );
      const checksum = createHash("sha256").update(content).digest("hex");
      const { rows } = await sql.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (rows.length) {
        if (rows[0].checksum !== checksum)
          throw new Error(`이미 적용한 migration이 변경되었습니다: ${name}`);
        continue;
      }
      await sql.query(content);
      await sql.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
    }
  });
}
if (process.argv[1]?.endsWith("/migrate.ts")) {
  try {
    await migrate(getDatabase());
    console.log("Migration complete.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await getPool().end();
  }
}
