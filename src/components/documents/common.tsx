import { Badge } from "@/components/ui/badge";
import type { UploadBatch, UploadItem } from "@/domain/ingestion/ports";

export type BatchSummary = UploadBatch & {
  itemCount: number;
  failedCount: number;
  extractedCount: number;
  partialCount: number;
  cancelledCount: number;
  pendingJobs: number;
};
export const modes = { FILES: "파일", FOLDER: "폴더", ZIP: "ZIP 압축" };
export const statuses = {
  UPLOADING: "업로드 중",
  STORED: "업로드 완료",
  READY: "처리 대기 / 추출 중",
  EXTRACTED: "추출 완료",
  UNSUPPORTED: "미지원",
  FAILED: "실패",
  CANCELLED: "중지됨",
};
export function ItemBadge({ item }: { item: UploadItem }) {
  const warning = item.contentQuality === "PARTIAL";
  return (
    <Badge
      variant="secondary"
      className={`doc-status ${warning || ["FAILED", "UNSUPPORTED", "CANCELLED"].includes(item.status) ? "doc-warning" : item.status === "EXTRACTED" ? "doc-success" : ""}`}
    >
      {warning
        ? "부분 추출"
        : item.format === "ZIP" && item.status === "EXTRACTED"
          ? "압축 해제 완료"
          : statuses[item.status]}
    </Badge>
  );
}
export function batchLabel(batch: BatchSummary) {
  if (batch.status === "OPEN") return "업로드 미확정";
  if (batch.pendingJobs) return "추출 진행 중";
  if (batch.cancelledCount) return "처리 중지됨";
  if (!batch.enumerationComplete) return "목록 확인 필요";
  if (batch.failedCount || batch.partialCount) return "일부 항목 확인 필요";
  if (batch.extractedCount < batch.itemCount) return "처리 대기";
  return "추출 완료";
}
export function dateLabel(value: string) {
  return new Date(value).toLocaleString("ko-KR");
}
export function bytesLabel(value: number) {
  return value < 1024 * 1024
    ? `${(value / 1024).toFixed(1)} KB`
    : `${(value / 1024 / 1024).toFixed(1)} MB`;
}
export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
