import { getPool, withWorkerLock } from "../src/infrastructure/db/connection";
import { createRuntime } from "../src/infrastructure/runtime";
try {
  const action = process.argv[2];
  if (action === "retry") {
    const app = await createRuntime();
    await app.repository.retry();
    console.log("실패 작업을 PENDING으로 변경했습니다. worker가 처리합니다.");
  } else if (action === "rebuild") {
    await withWorkerLock(async () => {
      const app = await createRuntime();
      await app.vectors.initialize();
      // Persist rebuild work before clearing derived data so a crash is recoverable.
      await app.repository.db.transaction((sql) =>
        app.repository.enqueueAll(sql),
      );
      await app.vectors.clear();
      console.log(
        "인덱스를 비우고 전체 원본을 PENDING으로 등록했습니다. worker를 시작하세요.",
      );
    });
  } else throw new Error("retry 또는 rebuild 명령이 필요합니다.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await getPool().end();
}
