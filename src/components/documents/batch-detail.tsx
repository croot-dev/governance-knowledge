"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileText,
  RefreshCw,
  RotateCcw,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ErrorNotice } from "@/components/shared";
import { api } from "@/components/api";
import type { BatchManifest } from "@/application/ingestion/service";
import type { ContentDocument } from "@/domain/ingestion/content";
import type { LinkResult } from "@/domain/enrichment/linking";
import type { UploadItem } from "@/domain/ingestion/ports";
import { ItemBadge, modes, dateLabel, downloadJson } from "./common";
import { LayoutView } from "./layout-view";

export function BatchDetail({ id }: { id: string }) {
  const [manifest, setManifest] = useState<BatchManifest | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const data = await api<BatchManifest>(`/api/upload-batches/${id}`);
        if (!disposed) {
          setManifest(data);
          setError("");
        }
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      } finally {
        if (!disposed) timer = setTimeout(load, 4000);
      }
    }
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [id, refresh]);
  async function finalize() {
    setFinalizing(true);
    try {
      await api(`/api/upload-batches/${id}/finalize`, { method: "POST" });
      setRefresh((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFinalizing(false);
    }
  }
  async function stopProcessing() {
    if (
      !window.confirm(
        "대기 중인 작업을 취소하고 실행 중인 OCR을 중단합니다. 중지한 파일은 나중에 다시 처리할 수 있습니다. 중지할까요?",
      )
    )
      return;
    setStopping(true);
    setNotice("");
    try {
      const result = await api<{ cancelled: number }>(
        `/api/upload-batches/${id}/cancel`,
        { method: "POST" },
      );
      setNotice(
        result.cancelled
          ? `작업 ${result.cancelled}개를 중지했습니다. 실행 중이던 파일은 몇 초 안에 멈춥니다.`
          : "중지할 작업이 없습니다.",
      );
      setRefresh((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStopping(false);
    }
  }
  async function retryFailed() {
    setRetrying(true);
    setNotice("");
    try {
      const result = await api<{ retried: number }>(
        `/api/upload-batches/${id}/retry`,
        { method: "POST" },
      );
      setNotice(
        result.retried
          ? `실패 항목 ${result.retried}개를 다시 처리 대기열에 넣었습니다.`
          : "다시 처리할 실패 항목이 없습니다.",
      );
      setRefresh((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetrying(false);
    }
  }
  const items = manifest?.items ?? [];
  const current = items.find((i) => i.id === selected);
  const issues = items.filter(
    (i) =>
      ["FAILED", "UNSUPPORTED", "CANCELLED"].includes(i.status) ||
      i.contentQuality === "PARTIAL",
  );
  // Failed and stopped items are both resumable with "다시 처리".
  const failed = items.filter((i) =>
    ["FAILED", "CANCELLED"].includes(i.status),
  ).length;
  const filtered = items.filter(
    (i) =>
      i.relativePath.toLowerCase().includes(query.toLowerCase()) &&
      (!onlyIssues || issues.includes(i)),
  );
  const terminal = items.filter((i) =>
    ["EXTRACTED", "FAILED", "UNSUPPORTED", "CANCELLED"].includes(i.status),
  ).length;
  const fullyExtracted = items.filter(
    (i) =>
      i.status === "EXTRACTED" &&
      i.format !== "ZIP" &&
      i.contentQuality === "COMPLETE",
  ).length;
  return (
    <div className="documents-workspace">
      <Link href="/documents" className="doc-back">
        <ArrowLeft size={15} />
        문서 워크스페이스
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">UPLOAD BATCH</span>
          <h1>
            {manifest?.batch ? modes[manifest.batch.mode] : "문서"} 처리 결과
          </h1>
          <p>
            {id.slice(0, 8)}
            {manifest?.batch && ` · ${dateLabel(manifest.batch.createdAt)}`}
          </p>
        </div>
        <div className="doc-actions">
          <Button variant="outline" onClick={() => setRefresh((v) => v + 1)}>
            <RefreshCw />
            새로고침
          </Button>
          {!!manifest?.pendingJobs && (
            <Button
              variant="destructive"
              disabled={stopping}
              onClick={stopProcessing}
            >
              <Square />
              {stopping ? "중지 중…" : "처리 중지"}
            </Button>
          )}
          {failed > 0 && manifest?.batch?.status === "FINALIZED" && (
            <Button variant="outline" disabled={retrying} onClick={retryFailed}>
              <RotateCcw />
              {retrying ? "재처리 요청 중…" : `실패·중지 ${failed}개 다시 처리`}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!manifest}
            onClick={() => downloadJson(manifest, `batch-${id}.json`)}
          >
            <Download />
            처리 내역 JSON
          </Button>
        </div>
      </div>
      {error && <ErrorNotice message={error} />}
      {notice && (
        <p className="doc-notice" role="status">
          {notice}
        </p>
      )}
      {!manifest && !error && (
        <p role="status">처리 내역을 불러오는 중입니다.</p>
      )}
      {manifest && (
        <>
          <div className="doc-stats">
            <div>
              <small>전체 항목 · 압축 포함</small>
              <strong>{items.length}</strong>
            </div>
            <div>
              <small>완전 추출 문서</small>
              <strong>{fullyExtracted}</strong>
            </div>
            <div>
              <small>확인할 항목</small>
              <strong>{issues.length}</strong>
            </div>
            <div>
              <small>대기 · 실행 작업</small>
              <strong>{manifest.pendingJobs}</strong>
            </div>
          </div>
          <div className="doc-card doc-progress">
            <div className="doc-section-heading">
              <strong>
                {manifest.batch?.status === "OPEN"
                  ? "업로드가 아직 확정되지 않았습니다"
                  : manifest.pendingJobs
                    ? "내용을 추출하고 있습니다"
                    : !manifest.batch?.enumerationComplete
                      ? "압축 목록을 확정하지 못했습니다"
                      : issues.length
                        ? "처리가 종료되었습니다. 확인할 항목이 있습니다."
                        : manifest.complete
                          ? "내용 추출이 완료되었습니다"
                          : "추출 대기 중입니다"}
              </strong>
              <span>
                {terminal} / {items.length}개 처리 종료
              </span>
            </div>
            <progress
              aria-label="파일 처리 진행률"
              value={terminal}
              max={Math.max(1, items.length)}
            />
            <p>
              추출 결과를 확인하는 단계입니다. RAG 의미분석·거버넌스 평가·내용
              보강은 아직 실행되지 않습니다.
            </p>
            {manifest.batch?.status === "OPEN" && (
              <div className="doc-actions">
                <span>
                  다른 창의 업로드가 끝난 뒤 확정하세요. 미완료 업로드는 실패로
                  기록됩니다.
                </span>
                <Button
                  disabled={
                    finalizing || items.some((i) => i.status === "UPLOADING")
                  }
                  onClick={finalize}
                >
                  {finalizing ? "확정 중…" : "업로드 확정 · 추출 시작"}
                </Button>
              </div>
            )}
          </div>
          <div className="doc-detail-grid">
            <section
              className="doc-card doc-file-list"
              aria-labelledby="files-title"
            >
              <div className="doc-section-heading">
                <h2 id="files-title">파일 목록</h2>
                <span>{filtered.length}개</span>
              </div>
              <Input
                aria-label="파일 경로 검색"
                placeholder="파일 이름 또는 경로 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <label className="doc-filter">
                <input
                  type="checkbox"
                  checked={onlyIssues}
                  onChange={(e) => setOnlyIssues(e.target.checked)}
                />
                실패 · 미지원 · 부분 추출만 보기
              </label>
              <div className="doc-file-items">
                {filtered.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`doc-file-row ${selected === item.id ? "selected" : ""}`}
                    aria-pressed={selected === item.id}
                    onClick={() => setSelected(item.id)}
                  >
                    <span className="doc-file-name">
                      <FileText size={16} />
                      <span>{item.relativePath}</span>
                    </span>
                    <span className="doc-file-meta">
                      <small>{item.format ?? "알 수 없는 형식"}</small>
                      <ItemBadge item={item} />
                    </span>
                  </button>
                ))}
                {!filtered.length && (
                  <p className="doc-empty">표시할 파일이 없습니다.</p>
                )}
              </div>
            </section>
            <section
              className="doc-card doc-inspector"
              aria-label="선택한 파일 결과"
            >
              {current ? (
                <FileInspector
                  key={`${current.id}:${current.status}:${current.contentQuality}`}
                  batchId={id}
                  item={current}
                />
              ) : (
                <div className="doc-empty">
                  <FileText size={32} />
                  <h3>파일을 선택하세요</h3>
                  <p>추출 내용, 원문 위치, 연결된 용어를 확인할 수 있습니다.</p>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function FileInspector({
  batchId,
  item,
}: {
  batchId: string;
  item: UploadItem;
}) {
  const [content, setContent] = useState<ContentDocument | null>(null);
  const [links, setLinks] = useState<LinkResult | null>(null);
  const [error, setError] = useState("");
  const [linksError, setLinksError] = useState("");
  const [tab, setTab] = useState<"content" | "links" | "layout">("content");
  const [limit, setLimit] = useState(50);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (item.status !== "EXTRACTED" || item.format === "ZIP") return;
    let stopped = false;
    const root = `/api/upload-batches/${batchId}/items/${item.id}`;
    api<ContentDocument>(`${root}/content`)
      .then((data) => {
        if (!stopped) {
          setContent(data);
          setError("");
        }
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    api<LinkResult>(`${root}/links`)
      .then((data) => {
        if (!stopped) {
          setLinks(data);
          setLinksError("");
        }
      })
      .catch((e) => {
        if (!stopped) setLinksError(e.message);
      });
    return () => {
      stopped = true;
    };
  }, [batchId, item.id, item.status, item.format, refresh]);
  // Model interpretations (layout) are kept apart from extracted and OCR text.
  const textBlocks = content?.blocks.filter((b) => !b.visual) ?? [];
  const visualBlocks = content?.blocks.filter((b) => b.visual) ?? [];
  const hasLayout = item.format === "IMAGE" || item.format === "PDF";
  return (
    <>
      <div className="doc-section-heading">
        <div>
          <h2 className="doc-path">{item.relativePath}</h2>
          <ItemBadge item={item} />
        </div>
        {content && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadJson(
                content,
                `${item.relativePath.split("/").at(-1)}.content.json`,
              )
            }
          >
            <Download />
            JSON
          </Button>
        )}
      </div>
      {item.error && <ErrorNotice message={item.error} />}
      {item.format === "ZIP" ? (
        <p className="doc-empty">
          압축 내부 파일을 목록에서 선택하면 개별 추출 결과를 볼 수 있습니다.
        </p>
      ) : item.status !== "EXTRACTED" ? (
        <p className="doc-empty">
          {item.status === "FAILED" || item.status === "UNSUPPORTED"
            ? "추출 결과가 없습니다. 사유를 확인하고 수정한 파일을 새 배치로 업로드하세요."
            : "추출이 끝나면 결과가 표시됩니다. 작업이 진행되지 않으면 분석 worker 실행 상태를 확인해주세요."}
        </p>
      ) : (
        <>
          {error && (
            <>
              <ErrorNotice message={error} />
              <Button
                variant="outline"
                onClick={() => setRefresh((v) => v + 1)}
              >
                결과 다시 불러오기
              </Button>
            </>
          )}
          {!content && !error && <p role="status">내용을 불러오는 중입니다.</p>}
          {content && (
            <>
              {content.quality.warnings.length > 0 && (
                <details
                  className="doc-warnings"
                  open={content.quality.status === "PARTIAL"}
                >
                  <summary>
                    추출 참고사항 {content.quality.warnings.length}건
                  </summary>
                  <ul>
                    {content.quality.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="doc-tabs" role="tablist" aria-label="파일 결과">
                <Button
                  id="content-tab"
                  role="tab"
                  aria-selected={tab === "content"}
                  aria-controls="content-panel"
                  variant={tab === "content" ? "secondary" : "ghost"}
                  onClick={() => setTab("content")}
                >
                  추출 내용 · {textBlocks.length}
                </Button>
                <Button
                  id="links-tab"
                  role="tab"
                  aria-selected={tab === "links"}
                  aria-controls="links-panel"
                  variant={tab === "links" ? "secondary" : "ghost"}
                  onClick={() => setTab("links")}
                >
                  용어 연결 · {links?.links.length ?? "…"}
                </Button>
                {hasLayout && (
                  <Button
                    id="layout-tab"
                    role="tab"
                    aria-selected={tab === "layout"}
                    aria-controls="layout-panel"
                    variant={tab === "layout" ? "secondary" : "ghost"}
                    onClick={() => setTab("layout")}
                  >
                    레이아웃 ·{" "}
                    {
                      visualBlocks.filter((b) => b.kind === "VISUAL_REGION")
                        .length
                    }
                  </Button>
                )}
              </div>
              {tab === "content" ? (
                <div
                  id="content-panel"
                  role="tabpanel"
                  aria-labelledby="content-tab"
                  className="doc-blocks"
                >
                  {!textBlocks.length && (
                    <p className="doc-empty">
                      추출된 텍스트가 없습니다. 이미지·PDF의 화면 구성은
                      레이아웃 탭에서 확인하세요.
                    </p>
                  )}
                  {textBlocks.slice(0, limit).map((block) => (
                    <article className="doc-block" key={block.id}>
                      <div className="doc-block-meta">
                        <Badge variant="outline">{block.kind}</Badge>
                        <span>
                          {block.origin === "OCR"
                            ? "OCR 인식 결과"
                            : block.origin === "INFERRED"
                              ? "추론된 내용"
                              : "원문 추출"}
                        </span>
                        <span>
                          {block.location.page && `${block.location.page}쪽 · `}
                          {block.location.startLine}–{block.location.endLine}행
                        </span>
                        {block.isProtected && <span>보호 구간</span>}
                      </div>
                      {block.table ? (
                        <div className="doc-table-scroll">
                          <table>
                            <thead>
                              <tr>
                                {block.table.header.map((c) => (
                                  <th key={c.id}>{c.text}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {block.table.rows.map((row, i) => (
                                <tr key={i}>
                                  {row.map((c) => (
                                    <td key={c.id}>{c.text}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <pre>{block.text}</pre>
                      )}
                    </article>
                  ))}
                  {textBlocks.length > limit && (
                    <Button
                      variant="outline"
                      onClick={() => setLimit((v) => v + 50)}
                    >
                      내용 더 보기 ({limit}/{textBlocks.length})
                    </Button>
                  )}
                </div>
              ) : tab === "layout" ? (
                <div
                  id="layout-panel"
                  role="tabpanel"
                  aria-labelledby="layout-tab"
                >
                  <LayoutView
                    blocks={visualBlocks}
                    imageUrl={
                      item.format === "IMAGE"
                        ? `/api/upload-batches/${batchId}/items/${item.id}/original`
                        : undefined
                    }
                  />
                </div>
              ) : (
                <div
                  id="links-panel"
                  role="tabpanel"
                  aria-labelledby="links-tab"
                >
                  <p className="doc-caption">
                    등록된 표 헤더와 필드 라벨을 기준으로 연결한 결과입니다.
                    문맥을 통한 LLM 판정이나 규칙 적용 결과는 아닙니다.
                  </p>
                  {linksError && <ErrorNotice message={linksError} />}{" "}
                  {!links && !linksError && (
                    <p role="status">용어 연결을 확인하는 중입니다.</p>
                  )}
                  {links?.links.map((link, i) => (
                    <div
                      className="doc-link-result"
                      key={`${link.blockId}-${i}`}
                    >
                      <strong>{link.value}</strong>
                      <p>
                        {link.evidence
                          .map((e) => (e.kind === "INPUT" ? e.quote : ""))
                          .filter(Boolean)
                          .join(", ")}{" "}
                        ·{" "}
                        {link.method === "HEADER"
                          ? "표 헤더 일치"
                          : "필드 라벨 일치"}
                      </p>
                      <Link
                        className="inline-link"
                        href={`/governance/terms/${link.termId}`}
                      >
                        연결된 표준 용어 보기 →
                      </Link>
                    </div>
                  ))}
                  {links && !links.links.length && (
                    <p className="doc-empty">명확히 연결된 용어가 없습니다.</p>
                  )}
                  {!!links?.unresolved.length && (
                    <div className="doc-warnings">
                      <strong>여러 용어에 해당하는 라벨</strong>
                      {links.unresolved.map((u, i) => (
                        <p key={i}>
                          {u.label} · 후보 {u.termIds.length}개
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
