"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import Link from "next/link";
import { useEffect, useState } from "react";
import { statuses, type Collection, type Page } from "@/domain/model";
import { api } from "./api";
import { EntityForm, labels } from "./entity-form";
import { Dialog, ErrorNotice, IndexBadge, StatusBadge } from "./shared";
export function EntityList({ collection }: { collection: Collection }) {
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState({ q: "", domain: "", status: "" });
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    Object.entries(filter).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    api<Page>(`/api/${collection}?${params}`)
      .then((r) => {
        if (active) {
          setData(r);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [collection, filter, page, refresh]);
  function reload() {
    setLoading(true);
    setRefresh((r) => r + 1);
  }
  const label = labels[collection];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            KNOWLEDGE LIBRARY <span>/ {label.english}</span>
          </div>
          <h1>
            {label.title}
            <span className="heading-count">{data?.total ?? "—"}</span>
          </h1>
          <p>{label.description}</p>
        </div>
        <Button
          variant="default"
          className="button primary"
          onClick={() => setCreating(true)}
        >
          <span>＋</span> {label.singular} 만들기
        </Button>
      </div>
      <div className="info-strip">
        <span className="info-symbol">↗</span>
        <p>
          {collection === "terms"
            ? "표준 용어는 거버넌스 지식의 시작점입니다. 표현과 규칙을 연결해 의미를 확장하세요."
            : collection === "expressions"
              ? "하나의 Term에 여러 표현을 연결할 수 있습니다. 같은 표현도 다른 Term에 연결할 수 있어요."
              : "규칙을 구조화해 관리하세요. 이 워크스페이스는 규칙을 저장하며 위반 여부를 판정하지 않습니다."}
        </p>
      </div>
      <section className="panel">
        <div className="panel-title">
          <h2>전체 {label.singular}</h2>
          <Button
            variant="ghost"
            className="text-button"
            onClick={reload}
            disabled={loading}
          >
            ↻ 새로고침
          </Button>
        </div>
        <form
          className="filter-bar"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setFilter({
              q: String(form.get("q")),
              domain: String(form.get("domain")),
              status: String(form.get("status")),
            });
            setPage(1);
            setLoading(true);
          }}
        >
          <div className="search-input">
            <span>⌕</span>
            <Input
              name="q"
              aria-label="이름 검색"
              placeholder={`${label.singular} 검색…`}
            />
          </div>
          <Input
            className="domain-filter"
            name="domain"
            aria-label="도메인 필터"
            placeholder="모든 도메인"
          />
          <NativeSelect name="status" aria-label="상태 필터">
            <option value="">모든 상태</option>
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </NativeSelect>
          <Button variant="outline" className="button secondary" type="submit">
            검색
          </Button>
        </form>
        {error && <ErrorNotice message={error} />}
        <div className="table-scroll">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{label.singular}명</TableHead>
                <TableHead>
                  {collection === "terms" ? "정의" : "연결 Term"}
                </TableHead>
                <TableHead>
                  {collection === "rules" ? "규칙 유형" : "도메인"}
                </TableHead>
                <TableHead>상태</TableHead>
                <TableHead>검색 인덱스</TableHead>
                <TableHead>
                  <span className="sr-only">상세 보기</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="table-empty">
                    데이터를 불러오는 중입니다…
                  </TableCell>
                </TableRow>
              ) : (
                data?.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link
                        className="entity-name"
                        href={`/governance/${collection}/${e.id}`}
                      >
                        <span className={`entity-icon ${collection}`}>
                          {collection === "terms"
                            ? "T"
                            : collection === "expressions"
                              ? "E"
                              : "R"}
                        </span>
                        {e.name ?? e.text}
                      </Link>
                      {collection === "expressions" && (
                        <small className="row-subtitle">{e.type}</small>
                      )}
                    </TableCell>
                    <TableCell className="description-cell">
                      {collection === "terms" ? (
                        e.definition
                      ) : (
                        <Link href={`/governance/terms/${e.termId}`}>
                          {e.termName} <span className="muted">↗</span>
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="domain-tag">
                        {collection === "rules" ? e.ruleType : e.domain}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={e.status} />
                    </TableCell>
                    <TableCell>
                      <IndexBadge
                        status={e.embeddingStatus}
                        error={e.embeddingError}
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        className="row-arrow"
                        aria-label={`${e.name ?? e.text} 상세 보기`}
                        href={`/governance/${collection}/${e.id}`}
                      >
                        →
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
              {!loading && !error && !data?.items.length && (
                <TableRow>
                  <TableCell colSpan={6} className="table-empty">
                    <span className="empty-symbol">◇</span>아직 표시할{" "}
                    {label.singular}가 없습니다.
                    <small>
                      검색 조건을 변경하거나 새로운 {label.singular}를
                      만들어보세요.
                    </small>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="pagination">
          <span>
            총 <strong>{data?.total ?? 0}</strong>개 · 페이지 {page}
          </span>
          <div>
            <Button
              variant="outline"
              className="button secondary small"
              disabled={page === 1 || loading}
              onClick={() => {
                setLoading(true);
                setPage((p) => p - 1);
              }}
            >
              이전
            </Button>
            <Button
              variant="outline"
              className="button secondary small"
              disabled={loading || page * 20 >= (data?.total ?? 0)}
              onClick={() => {
                setLoading(true);
                setPage((p) => p + 1);
              }}
            >
              다음
            </Button>
          </div>
        </div>
      </section>
      <div className="page-note">
        <span>◎</span> 활성 데이터만 시맨틱 검색에 표시됩니다. 인덱싱 상태는
        새로고침으로 확인할 수 있습니다.
      </div>
      {creating && (
        <Dialog
          title={`${label.singular} 만들기`}
          onClose={() => setCreating(false)}
        >
          <EntityForm
            collection={collection}
            onCancel={() => setCreating(false)}
            onSaved={() => {
              setCreating(false);
              reload();
            }}
          />
        </Dialog>
      )}
    </>
  );
}
