"use client";
import type { IndexStatus, Status } from "@/domain/model";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog as DialogRoot,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
const statusLabels: Record<Status, string> = {
  ACTIVE: "활성",
  DRAFT: "초안",
  INACTIVE: "비활성",
  DEPRECATED: "사용 중단",
};
export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge
      variant="secondary"
      className={`badge status-${status.toLowerCase()}`}
    >
      <i />
      {statusLabels[status]}
    </Badge>
  );
}
export function IndexBadge({
  status,
  error,
}: {
  status?: IndexStatus;
  error?: string | null;
}) {
  return (
    <span
      title={error ?? undefined}
      className={`index-badge index-${status?.toLowerCase() ?? "pending"}`}
    >
      <span>◦</span>{" "}
      {
        {
          PENDING: "인덱싱 대기",
          PROCESSING: "인덱싱 중",
          READY: "인덱싱 완료",
          FAILED: "인덱싱 실패",
        }[status ?? "PENDING"]
      }
    </span>
  );
}
export function ErrorNotice({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="error-notice">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <DialogRoot
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="dialog sm:max-w-[660px]"
        showCloseButton={false}
      >
        <header>
          <div>
            <span className="eyebrow">GOVERNANCE LIBRARY</span>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">
              거버넌스 데이터를 관리합니다.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="icon-button"
              aria-label="닫기"
            >
              ×
            </Button>
          </DialogClose>
        </header>
        {children}
      </DialogContent>
    </DialogRoot>
  );
}
