"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  collectionOf,
  entityTypes,
  type Profile,
  type SearchResult,
} from "@/domain/model";
import { api } from "./api";
import { ErrorNotice } from "./shared";
export function SemanticSearch() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    api<{ profile: Profile }>("/api/config")
      .then((r) => setProfile(r.profile))
      .catch((e) => setError(e.message));
  }, []);
  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError("");
    try {
      const r = await api<{ results: SearchResult[] }>(
        "/api/search/governance",
        {
          method: "POST",
          body: JSON.stringify({
            query,
            types: form.getAll("types"),
            ...(form.get("domain") ? { domain: form.get("domain") } : {}),
            topK: Number(form.get("topK")),
          }),
        },
      );
      setResults(r.results);
    } catch (e) {
      setError((e as Error).message);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            DISCOVERY <span>/ SEMANTIC SEARCH</span>
          </div>
          <h1>시맨틱 검색</h1>
          <p>표현 너머의 의미로, 관련 용어와 거버넌스 규칙을 탐색하세요.</p>
        </div>
        <span className="model-tag">
          <i />
          {profile?.provider ?? "확인 중"} · {profile?.dimensions ?? "—"}d
        </span>
      </div>
      {profile?.provider === "mock" && (
        <div className="mock-notice">
          <strong>Mock 모드로 실행 중입니다.</strong>
          <p>
            인덱싱과 검색 흐름 확인용입니다. 현재 점수와 순서는 실제 의미
            유사도를 나타내지 않습니다.
          </p>
        </div>
      )}
      <section className="panel search-panel">
        <div className="panel-title">
          <h2>지식 검색</h2>
          <span className="muted small-text">활성 데이터만 검색</span>
        </div>
        <form onSubmit={search}>
          <div className="large-search">
            <span>⌕</span>
            <Input
              aria-label="검색어"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="어떤 데이터 지식을 찾고 있나요?"
              required
              maxLength={2000}
            />
            <Button
              variant="default"
              className="button primary"
              disabled={loading}
            >
              {loading ? "검색 중…" : "검색하기 →"}
            </Button>
          </div>
          <div className="search-filters">
            <fieldset>
              <legend>검색 대상</legend>
              {entityTypes.map((type) => (
                <Label key={type}>
                  <Checkbox name="types" value={type} defaultChecked />
                  {type === "TERM"
                    ? "Term"
                    : type === "EXPRESSION"
                      ? "Expression"
                      : "Rule"}
                </Label>
              ))}
            </fieldset>
            <div className="field">
              <Label htmlFor="search-domain">도메인</Label>
              <Input
                id="search-domain"
                name="domain"
                placeholder="모든 도메인"
              />
            </div>
            <div className="field top-k">
              <Label htmlFor="top-k">결과 수</Label>
              <NativeSelect id="top-k" name="topK" defaultValue="10">
                {[10, 20, 50, 100].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="suggestions">
            <span>예시 검색</span>
            {["고객 식별번호", "개인정보 마스킹", "필수 데이터 형식"].map(
              (s) => (
                <Button
                  variant="ghost"
                  key={s}
                  type="button"
                  onClick={() => setQuery(s)}
                >
                  {s} ↗
                </Button>
              ),
            )}
          </div>
        </form>
      </section>
      {error && <ErrorNotice message={error} />}
      <div className="results-heading">
        <h2>
          검색 결과{" "}
          {results && <span className="count-pill">{results.length}</span>}
        </h2>
        <span>코사인 유사도 순 · 정답 확률이 아닙니다</span>
      </div>
      {loading ? (
        <section className="panel empty-panel">
          관련 지식을 찾고 있습니다…
        </section>
      ) : results === null ? (
        <section className="panel search-empty">
          <span className="search-empty-icon">⌕</span>
          <h3>지식의 연결을 찾아보세요</h3>
          <p>
            검색어를 입력하면 관련 용어, 표현과 규칙을
            <br />
            한곳에서 확인할 수 있습니다.
          </p>
        </section>
      ) : results.length === 0 ? (
        <section className="panel empty-panel">
          <h3>검색 결과가 없습니다.</h3>
          <p className="muted">
            필터와 원본 상태를 확인하거나 인덱싱 완료 후 다시 검색해주세요.
          </p>
        </section>
      ) : (
        <div className="search-results">
          {results.map((r, i) => (
            <Link
              key={`${r.type}:${r.id}`}
              className="panel result-card"
              href={`/governance/${collectionOf[r.type]}/${r.id}`}
            >
              <div className="result-rank">
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="result-content">
                <div>
                  <span className={`type-tag type-${r.type.toLowerCase()}`}>
                    {r.type}
                  </span>
                  <span className="muted small-text">{r.domain}</span>
                </div>
                <h3>{r.text}</h3>
                {r.termName && <p>↳ {r.termName}</p>}
              </div>
              <div className="result-score">
                <strong>{r.score.toFixed(3)}</strong>
                <span>유사도</span>
              </div>
              <span className="row-arrow">→</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
