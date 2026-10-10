import { setTimeout } from "node:timers/promises";
import { getPool } from "../src/infrastructure/db/connection";
import { createRuntime } from "../src/infrastructure/runtime";
// Runs ingestion (archive expansion, extraction) now; analysis stages join this worker later.
// Jobs are leased, so several workers may run; the index worker is never used for this.
let stop = false;
process.on("SIGINT", () => (stop = true));
process.on("SIGTERM", () => (stop = true));
try {
  const app = await createRuntime();
  const worker = app.createIngestionWorker((line) =>
    console.log(`${new Date().toISOString()} ${line}`),
  );
  if (process.argv.includes("--cleanup"))
    console.log(
      `정리한 미완료 업로드: ${await app.ingestion.cleanupStaleUploads()}`,
    );
  console.log(
    `Analysis worker ready. OCR: ${process.env.OCR_PROVIDER ?? "none"} ${process.env.OCR_OLLAMA_MODEL ?? ""} @ ${process.env.OCR_OLLAMA_BASE_URL ?? "-"}`,
  );
  while (!stop) {
    const worked = await worker.processOne();
    if (!worked) {
      if (process.argv.includes("--once")) break;
      await setTimeout(1000);
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await getPool().end();
}
