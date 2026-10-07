"use client";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Collection, Entity, Page } from "@/domain/model";
import { api } from "./api";
import { EntityForm, labels } from "./entity-form";
import { Dialog, ErrorNotice, IndexBadge, StatusBadge } from "./shared";
function Relations({
  collection,
  termId,
}: {
  collection: "expressions" | "rules";
  termId: string;
}) {
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<Page>(`/api/${collection}?termId=${termId}&page=${page}&pageSize=10`)
      .then((r) => {
        if (active) {
          setData(r);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [collection, termId, page]);
  return (
    <section className="panel relation-panel">
      <div className="panel-title">
        <h2>
          연결된 {labels[collection].title}{" "}
          <span className="count-pill">{data?.total ?? "—"}</span>
        </h2>
        <Link href={`/governance/${collection}`} className="text-button">
          관리 →
        </Link>
      </div>
      {error && <ErrorNotice message={error} />}
      <div className="relation-list">
        {data?.items.map((e) => (
          <Link key={e.id} href={`/governance/${collection}/${e.id}`}>
            <div>
              <strong>{e.name ?? e.text}</strong>
              <small>{e.ruleType ?? e.type}</small>
            </div>
            <StatusBadge status={e.status} />
            <span>→</span>
          </Link>
        ))}
        {!data && !error && <p className="muted">불러오는 중…</p>}
        {data && !data.items.length && (
          <p className="muted">연결된 항목이 없습니다.</p>
        )}
      </div>
      {data && data.total > 10 && (
        <div className="pagination">
          <Button
            variant="ghost"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            이전
          </Button>
          <span>{page}</span>
          <Button
            variant="ghost"
            disabled={page * 10 >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            다음
          </Button>
        </div>
      )}
    </section>
  );
}
export function EntityDetail({
  collection,
  id,
}: {
  collection: Collection;
  id: string;
}) {
  const router = useRouter();
  const [entity, setEntity] = useState<Entity | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    api<Entity>(`/api/${collection}/${id}`)
      .then((r) => {
        if (active) {
          setEntity(r);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [collection, id, refresh]);
  async function change(action: "delete" | "deactivate") {
    setBusy(true);
    setError("");
    try {
      const result = await api<Entity>(`/api/${collection}/${id}`, {
        method: action === "delete" ? "DELETE" : "PATCH",
        ...(action === "deactivate"
          ? { body: JSON.stringify({ status: "INACTIVE" }) }
          : {}),
      });
      if (action === "delete") router.push(`/governance/${collection}`);
      else setEntity(result);
    } catch (e) {
      setError((e as Error).message);
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }
  const label = labels[collection];
  return (
    <>
      <Link href={`/governance/${collection}`} className="back-link">
        ← {label.title} 목록
      </Link>
      {error && <ErrorNotice message={error} />}
      {!entity ? (
        <div className="panel empty-panel">
          {error ? "항목을 표시할 수 없습니다." : "불러오는 중…"}
        </div>
      ) : (
        <>
          <div className="page-heading detail-heading">
            <div>
              <div className="eyebrow">
                {label.english} <span>/ DETAIL</span>
              </div>
              <h1>{entity.name ?? entity.text}</h1>
              <p>
                {entity.domain} <span className="slash">/</span> Version{" "}
                {entity.version}
              </p>
            </div>
            <div className="heading-actions">
              <Button
                variant="outline"
                className="button secondary"
                onClick={() => setRefresh((r) => r + 1)}
              >
                ↻ 새로고침
              </Button>
              <Button
                variant="default"
                className="button primary"
                onClick={() => setEditing(true)}
              >
                편집
              </Button>
            </div>
          </div>
          <section className="panel detail-panel">
            <div className="panel-title">
              <h2>기본 정보</h2>
              <StatusBadge status={entity.status} />
            </div>
            <dl className="detail-grid">
              <div>
                <dt>{collection === "terms" ? "정의" : "설명 / 유형"}</dt>
                <dd>
                  {entity.definition ?? entity.description ?? entity.type}
                </dd>
              </div>
              <div>
                <dt>검색 인덱스</dt>
                <dd>
                  <IndexBadge
                    status={entity.embeddingStatus}
                    error={entity.embeddingError}
                  />
                  {entity.embeddingError && (
                    <p className="error-text">{entity.embeddingError}</p>
                  )}
                </dd>
              </div>
              {entity.termId && (
                <div>
                  <dt>연결 Term</dt>
                  <dd>
                    <Link
                      className="inline-link"
                      href={`/governance/terms/${entity.termId}`}
                    >
                      {entity.termName} ↗
                    </Link>
                  </dd>
                </div>
              )}
              {entity.ruleType && (
                <div>
                  <dt>규칙 유형 · 우선순위</dt>
                  <dd>
                    {entity.ruleType} · {entity.priority}
                  </dd>
                </div>
              )}
              <div>
                <dt>마지막 수정</dt>
                <dd>{new Date(entity.updatedAt).toLocaleString("ko-KR")}</dd>
              </div>
              <div>
                <dt>식별자</dt>
                <dd className="mono small-text">{entity.id}</dd>
              </div>
            </dl>
          </section>
          {collection === "rules" && (
            <div className="json-grid">
              {(["scope", "condition", "action"] as const).map((key) => (
                <section className="panel" key={key}>
                  <div className="panel-title">
                    <h2>{key}</h2>
                  </div>
                  <pre>{JSON.stringify(entity[key], null, 2)}</pre>
                </section>
              ))}
            </div>
          )}
          {collection === "terms" && (
            <div className="relations-grid">
              <Relations collection="expressions" termId={id} />
              <Relations collection="rules" termId={id} />
            </div>
          )}
          <section className="lifecycle-panel">
            <div>
              <h3>수명 주기 관리</h3>
              <p>비활성화 또는 삭제한 데이터는 검색에서 제외됩니다.</p>
            </div>
            <div className="heading-actions">
              <Button
                variant="outline"
                className="button secondary"
                disabled={busy || entity.status === "INACTIVE"}
                onClick={() => change("deactivate")}
              >
                비활성화
              </Button>
              <Button
                variant="destructive"
                className="button danger"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                삭제
              </Button>
            </div>
          </section>
          {editing && (
            <Dialog
              title={`${label.singular} 편집`}
              onClose={() => setEditing(false)}
            >
              <EntityForm
                collection={collection}
                entity={entity}
                onCancel={() => setEditing(false)}
                onSaved={(result) => {
                  setEntity(result);
                  setEditing(false);
                }}
              />
            </Dialog>
          )}
          {confirmDelete && (
            <Dialog
              title={`${label.singular} 삭제`}
              onClose={() => setConfirmDelete(false)}
            >
              <div className="form-body">
                <p>“{entity.name ?? entity.text}”를 삭제하시겠습니까?</p>
                <p className="muted">
                  기본 목록과 검색에서 제외됩니다.
                  {collection === "terms" &&
                    " 연결된 표현과 규칙이 있으면 먼저 정리해야 합니다."}
                </p>
              </div>
              <div className="form-actions">
                <Button
                  variant="outline"
                  className="button secondary"
                  onClick={() => setConfirmDelete(false)}
                >
                  취소
                </Button>
                <Button
                  variant="destructive"
                  className="button danger"
                  disabled={busy}
                  onClick={() => change("delete")}
                >
                  {busy ? "삭제 중…" : "삭제 확인"}
                </Button>
              </div>
            </Dialog>
          )}
        </>
      )}
    </>
  );
}
