import { setTimeout } from "node:timers/promises";
import { getPool, withWorkerLock } from "../src/infrastructure/db/connection";
import { createRuntime } from "../src/infrastructure/runtime";
let stop = false;
process.on("SIGINT", () => {
  stop = true;
});
process.on("SIGTERM", () => {
  stop = true;
});
try {
  await withWorkerLock(async () => {
    const app = await createRuntime();
    await app.vectors.initialize();
    await app.repository.recover();
    console.log(
      `Worker ready: ${app.embedding.profile.provider} (${app.embedding.profile.id})`,
    );
    while (!stop) {
      const worked = await app.indexing.processOne();
      if (!worked) {
        if (process.argv.includes("--once")) break;
        await setTimeout(1000);
      }
    }
    const { rows } = await app.repository.db.query(
      'SELECT status,count(*) FROM index_jobs WHERE "profileId"=$1 GROUP BY status',
      [app.embedding.profile.id],
    );
    console.log(rows);
    if (rows.some((r) => r.status === "FAILED")) process.exitCode = 1;
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await getPool().end();
}
