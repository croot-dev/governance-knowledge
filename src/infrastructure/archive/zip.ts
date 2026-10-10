import yauzl, { type Entry, type ZipFile } from "yauzl";
import { AppError } from "../../domain/model";
import { LIMITS, normalizeRelativePath } from "../../domain/ingestion/intake";
import type {
  ArchiveEntry,
  ArchiveEntryIssue,
  ArchiveReader,
} from "../../domain/ingestion/ports";

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const NESTED_ARCHIVE = /\.(zip|jar|7z|rar|tar|gz|tgz|bz2|xz)$/i;

export class ArchiveRejectedError extends Error {}

function open(bytes: Uint8Array): Promise<ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      // yauzl rejects absolute and parent-relative names; sizes are verified while reading.
      { lazyEntries: true, autoClose: false, validateEntrySizes: true },
      (error, zip) => (error ? reject(error) : resolve(zip)),
    ),
  );
}

function readAll(zip: ZipFile, onEntry: (entry: Entry) => void) {
  return new Promise<void>((resolve, reject) => {
    zip.on("entry", (entry: Entry) => {
      try {
        onEntry(entry);
        zip.readEntry();
      } catch (error) {
        reject(error);
      }
    });
    zip.on("end", () => resolve());
    zip.on("error", reject);
    zip.readEntry();
  });
}

export class ZipArchiveReader implements ArchiveReader {
  async list(bytes: Uint8Array) {
    const { archive } = LIMITS;
    if (bytes.byteLength > archive.maxBytes)
      throw new ArchiveRejectedError("압축 파일 크기 한도를 넘었습니다.");
    let zip: ZipFile;
    try {
      zip = await open(bytes);
    } catch (error) {
      throw new ArchiveRejectedError(
        `ZIP을 열 수 없습니다: ${(error as Error).message}`,
      );
    }
    const entries: ArchiveEntry[] = [];
    const issues: ArchiveEntryIssue[] = [];
    const seen = new Set<string>();
    let total = 0;
    let count = 0;
    const issue = (
      path: string,
      status: ArchiveEntryIssue["status"],
      reason: string,
    ) => issues.push({ path, status, reason });

    const inspect = (entry: Entry) => {
      if (entry.fileName.endsWith("/")) return;
      if (++count > archive.maxEntries)
        throw new ArchiveRejectedError("압축 항목 수 한도를 넘었습니다.");
      total += entry.uncompressedSize;
      if (total > archive.maxTotalBytes)
        throw new ArchiveRejectedError("압축 해제 총 용량 한도를 넘었습니다.");
      if (
        entry.compressedSize > 0 &&
        entry.uncompressedSize / entry.compressedSize > archive.maxRatio
      )
        throw new ArchiveRejectedError(
          `압축 비율이 비정상적으로 큽니다: ${entry.fileName}`,
        );
      let path: string;
      try {
        path = normalizeRelativePath(entry.fileName);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        return issue(entry.fileName, "FAILED", error.message);
      }
      if (seen.has(path)) return issue(path, "FAILED", "중복 경로입니다.");
      seen.add(path);
      if (((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK)
        return issue(path, "FAILED", "심볼릭 링크는 허용하지 않습니다.");
      if (entry.isEncrypted())
        return issue(path, "UNSUPPORTED", "암호화된 항목은 지원하지 않습니다.");
      if (NESTED_ARCHIVE.test(path))
        return issue(path, "UNSUPPORTED", "중첩 압축은 지원하지 않습니다.");
      if (entry.uncompressedSize > LIMITS.maxFileBytes)
        return issue(path, "FAILED", "파일 크기 한도를 넘었습니다.");
      entries.push({
        path,
        size: entry.uncompressedSize,
        open: () => zip.openReadStreamPromise(entry),
      });
    };

    try {
      await readAll(zip, inspect);
    } catch (error) {
      zip.close();
      if (error instanceof ArchiveRejectedError) throw error;
      throw new ArchiveRejectedError(
        `ZIP 목록을 확정하지 못했습니다: ${(error as Error).message}`,
      );
    }
    return { entries, issues, close: () => zip.close() };
  }
}
