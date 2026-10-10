import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { once } from "node:events";
import { AppError } from "../../domain/model";
import type {
  ArtifactStore,
  StoredObject,
} from "../../domain/ingestion/ports";

const KEY = /^[a-z0-9-]+(\/[A-Za-z0-9._@-]+)+$/;

export class LocalArtifactStore implements ArtifactStore {
  private root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string) {
    if (!KEY.test(key) || key.includes(".."))
      throw new Error(`잘못된 저장 key입니다: ${key}`);
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep))
      throw new Error(`저장소 밖을 가리키는 key입니다: ${key}`);
    return path;
  }

  async put(
    key: string,
    body: AsyncIterable<Uint8Array>,
    { maxBytes }: { maxBytes: number },
  ): Promise<StoredObject> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    // Readers only ever see a complete object: write aside, then rename.
    const temp = join(dirname(target), `.${randomUUID()}.partial`);
    const hash = createHash("sha256");
    const out = createWriteStream(temp, { flags: "wx" });
    let size = 0;
    try {
      for await (const chunk of body) {
        size += chunk.byteLength;
        if (size > maxBytes)
          throw new AppError(413, "FILE_TOO_LARGE", "파일 크기 한도를 넘었습니다.");
        hash.update(chunk);
        if (!out.write(chunk)) await once(out, "drain");
      }
      out.end();
      await once(out, "close");
      await rename(temp, target);
      return { size, sha256: hash.digest("hex") };
    } catch (error) {
      // destroy() is async; deleting before close would race the file open and leave a partial.
      if (!out.closed) {
        const closed = once(out, "close");
        out.destroy();
        await closed;
      }
      await rm(temp, { force: true });
      throw error;
    }
  }

  async read(key: string) {
    return new Uint8Array(await readFile(this.path(key)));
  }

  async exists(key: string) {
    try {
      return (await stat(this.path(key))).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

export async function* bytesOf(data: Uint8Array): AsyncIterable<Uint8Array> {
  yield data;
}
