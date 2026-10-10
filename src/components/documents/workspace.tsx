"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  FileUp,
  FolderOpen,
  Archive,
  RefreshCw,
  UploadCloud,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorNotice } from "@/components/shared";
import { api } from "@/components/api";
import type { UploadBatch } from "@/domain/ingestion/ports";
import type { BatchMode } from "@/domain/ingestion/intake";
import { LIMITS } from "@/domain/ingestion/intake";
import {
  type BatchSummary,
  batchLabel,
  bytesLabel,
  dateLabel,
  modes,
} from "./common";

export function DocumentWorkspace() {
  const router = useRouter();
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [error, setError] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<BatchMode>("FILES");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [batchId, setBatchId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const data = await api<{ items: BatchSummary[] }>(
          "/api/upload-batches",
        );
        if (!stopped) {
          setBatches(data.items);
          setListError("");
        }
      } catch (e) {
        if (!stopped) setListError((e as Error).message);
      } finally {
        if (!stopped) {
          setLoading(false);
          timer = setTimeout(load, 5000);
        }
      }
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  function select(selected: File[], selectedMode: BatchMode) {
    if (busy) return;
    setError("");
    setBatchId(null);
    if (selected.length > LIMITS.maxBatchItems) {
      setError(
        `한 번에 선택할 수 있는 파일은 ${LIMITS.maxBatchItems}개까지입니다.`,
      );
      return;
    }
    const large = selected.find((f) => f.size > LIMITS.maxFileBytes);
    if (large) {
      setError(`${large.name}: 파일당 50 MB 한도를 초과했습니다.`);
      return;
    }
    setMode(selectedMode);
    setFiles(selected);
    setProgress(0);
  }

  async function upload() {
    if (!files.length || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    let id: string | null = null;
    try {
      const batch = await api<UploadBatch>("/api/upload-batches", {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      id = batch.id;
      setBatchId(id);
      // Sequential uploads keep browser/server memory and API pressure bounded.
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const path =
          mode === "FOLDER" ? file.webkitRelativePath || file.name : file.name;
        await api(
          `/api/upload-batches/${id}/items?path=${encodeURIComponent(path)}`,
          {
            method: "POST",
            body: file,
            headers: { "Content-Type": "application/octet-stream" },
          },
        );
        setProgress(i + 1);
      }
      await api(`/api/upload-batches/${id}/finalize`, { method: "POST" });
      router.push(`/documents/${id}`);
    } catch (e) {
      setError(
        `${(e as Error).message}${id ? " 업로드된 항목은 보존됩니다. 배치에서 확인한 뒤 처리 시작을 선택하세요. 나머지 파일은 새 배치로 업로드할 수 있습니다." : ""}`,
      );
      setRefresh((v) => v + 1);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  return (
    <div className="documents-workspace">
      <div className="page-heading">
        <div>
          <span className="eyebrow">DOCUMENT WORKSPACE</span>
          <h1>문서 워크스페이스</h1>
          <p>파일을 모으고, 내용을 추출하고, 회사의 기준과 연결하세요.</p>
        </div>
        <Badge variant="outline">멀티모달 문서 수집</Badge>
      </div>
      <div className="doc-pipeline" aria-label="서비스 처리 단계">
        <div>
          <span>01</span>
          <strong>업로드</strong>
          <small>파일 · 폴더 · ZIP</small>
        </div>
        <ArrowRight aria-hidden="true" />
        <div>
          <span>02</span>
          <strong>내용 추출</strong>
          <small>텍스트 · 표 · OCR</small>
        </div>
        <ArrowRight aria-hidden="true" />
        <div className="doc-planned">
          <span>03</span>
          <strong>의미분석 · 보강</strong>
          <small>준비 중</small>
        </div>
      </div>
      <section className="doc-card doc-upload" aria-labelledby="upload-title">
        <div className="doc-section-heading">
          <div>
            <h2 id="upload-title">새 문서 업로드</h2>
            <p>원본은 보존하고 파일마다 추출 결과를 만듭니다.</p>
          </div>
          <UploadCloud size={24} />
        </div>
        <div
          className="doc-upload-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (
              Array.from(e.dataTransfer.items).some(
                (item) => item.webkitGetAsEntry?.()?.isDirectory,
              )
            ) {
              setError("폴더는 아래 폴더 선택 버튼으로 업로드해주세요.");
              return;
            }
            select(Array.from(e.dataTransfer.files), "FILES");
          }}
        >
          <FileUp size={32} aria-hidden="true" />
          <h3>파일을 여기에 놓거나 선택하세요</h3>
          <p>PDF, 이미지, MD, TXT, LOG · 파일당 최대 50 MB</p>
          <div className="doc-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setMode("FILES");
                if (input.current) {
                  input.current.accept =
                    ".pdf,.png,.jpg,.jpeg,.webp,.md,.markdown,.txt,.log";
                  input.current.click();
                }
              }}
            >
              <FileUp />
              파일 선택
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => folder.current?.click()}
            >
              <FolderOpen />
              폴더 선택
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setMode("ZIP");
                if (input.current) {
                  input.current.accept = ".zip";
                  input.current.click();
                }
              }}
            >
              <Archive />
              ZIP 선택
            </Button>
          </div>
          <input
            className="sr-only"
            tabIndex={-1}
            aria-label="파일 선택"
            ref={input}
            type="file"
            multiple
            onChange={(e) => {
              if (e.target.files?.length)
                select(Array.from(e.target.files), mode);
              e.target.value = "";
            }}
          />
          <input
            className="sr-only"
            tabIndex={-1}
            aria-label="폴더 선택"
            ref={folder}
            type="file"
            multiple
            {...{ webkitdirectory: "" }}
            onChange={(e) => {
              if (e.target.files?.length)
                select(Array.from(e.target.files), "FOLDER");
              e.target.value = "";
            }}
          />
        </div>
        {files.length > 0 && (
          <div className="doc-selection">
            <div className="doc-section-heading">
              <strong>
                {modes[mode]} · {files.length}개 선택{" "}
                <span className="muted">
                  ({bytesLabel(files.reduce((sum, f) => sum + f.size, 0))})
                </span>
              </strong>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setFiles([]);
                  setBatchId(null);
                  setError("");
                }}
              >
                선택 비우기
                <X />
              </Button>
            </div>
            <ul>
              {files.map((f, i) => (
                <li key={`${f.webkitRelativePath || f.name}-${i}`}>
                  <span>{f.webkitRelativePath || f.name}</span>
                  <small>{bytesLabel(f.size)}</small>
                </li>
              ))}
            </ul>
            <div className="doc-upload-footer">
              <p role="status">
                {busy
                  ? `${progress} / ${files.length}개 업로드 완료 · 창을 닫지 마세요.`
                  : "폴더의 하위 경로를 유지합니다. 미지원 파일은 상태와 사유를 남깁니다."}
              </p>
              <Button disabled={busy || !!batchId} onClick={upload}>
                {busy ? "업로드 중…" : "업로드하고 추출 시작"}
                <ArrowRight />
              </Button>
            </div>
          </div>
        )}
        {error && <ErrorNotice message={error} />}
        {batchId && !busy && (
          <Link className="inline-link" href={`/documents/${batchId}`}>
            업로드 배치 확인 →
          </Link>
        )}
      </section>
      <section className="doc-card" aria-labelledby="recent-title">
        <div className="doc-section-heading">
          <div>
            <h2 id="recent-title">최근 업로드</h2>
            <p>최근 50개 배치 · 상태는 5초마다 갱신됩니다.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRefresh((v) => v + 1)}
          >
            <RefreshCw />
            새로고침
          </Button>
        </div>
        {listError && <ErrorNotice message={listError} />}
        {loading ? (
          <p className="doc-empty" role="status">
            업로드 내역을 불러오는 중입니다.
          </p>
        ) : !batches.length ? (
          <div className="doc-empty">
            <FolderOpen size={30} />
            <h3>첫 문서를 업로드해보세요</h3>
            <p>업로드한 파일의 상태와 추출 결과가 여기에 표시됩니다.</p>
          </div>
        ) : (
          <div className="doc-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>업로드 배치</th>
                  <th>항목 수</th>
                  <th>진행 상태</th>
                  <th>생성 시각</th>
                  <th>
                    <span className="sr-only">상세</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link
                        className="doc-batch-link"
                        href={`/documents/${b.id}`}
                      >
                        {modes[b.mode]} 업로드 <span>{b.id.slice(0, 8)}</span>
                      </Link>
                    </td>
                    <td>{b.itemCount}개</td>
                    <td>
                      <Badge variant="secondary">{batchLabel(b)}</Badge>
                    </td>
                    <td>{dateLabel(b.createdAt)}</td>
                    <td>
                      <Link
                        href={`/documents/${b.id}`}
                        aria-label={`${b.id.slice(0, 8)} 배치 보기`}
                      >
                        <ArrowRight size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
