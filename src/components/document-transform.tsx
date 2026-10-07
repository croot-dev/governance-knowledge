"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { DocumentTransformResult } from "@/application/transform";
import { api } from "./api";
import { ErrorNotice } from "./shared";

const MAX_BYTES = 1024 * 1024;

function download(fileName: string, markdown: string) {
  const url = URL.createObjectURL(
    new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.replace(/(\.(md|markdown))$/i, ".governed$1");
  link.click();
  URL.revokeObjectURL(url);
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className={`transform-stat tone-${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Report({ result }: { result: DocumentTransformResult }) {
  const masked = result.maskings.reduce((sum, m) => sum + m.count, 0);
  const replaced = result.replacements.reduce((sum, r) => sum + r.count, 0);
  const violations = result.violations.reduce((sum, v) => sum + v.count, 0);
  return (
    <section className="panel transform-report" aria-label="적용 결과">
      <div className="transform-stats">
        <Stat label="표준 용어 치환" value={replaced} tone="purple" />
        <Stat label="마스킹" value={masked} tone="green" />
        <Stat label="남은 위반" value={violations} tone="red" />
        <Stat label="미적용 규칙" value={result.skipped.length} tone="muted" />
      </div>
      {result.errors.length > 0 && (
        <ul className="transform-list tone-red">
          {result.errors.map((e) => (
            <li key={e.ruleId}>
              <b>{e.ruleName}</b> {e.message}
            </li>
          ))}
        </ul>
      )}
      <h3>표준 용어 치환</h3>
      {result.replacements.length ? (
        <ul className="transform-list">
          {result.replacements.map((r) => (
            <li key={`${r.from}:${r.termId}`}>
              <del>{r.from}</del> → <ins>{r.to}</ins>
              <span className="count-pill">{r.count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small-text">바꿀 비표준 표현이 없습니다.</p>
      )}
      {result.ambiguous.length > 0 && (
        <>
          <h3>모호한 표현 · 그대로 둠</h3>
          <ul className="transform-list">
            {result.ambiguous.map((a) => (
              <li key={a.text}>
                {a.text}{" "}
                <span className="muted">↳ {a.termNames.join(", ")}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>규칙</h3>
      <ul className="transform-list">
        {result.maskings.map((m) => (
          <li key={m.ruleId}>
            <span className="type-tag">MASKING</span> {m.ruleName}
            <span className="count-pill">{m.count}</span>
          </li>
        ))}
        {result.violations.map((v) => (
          <li key={v.ruleId} className="tone-red">
            <span className="type-tag">PROHIBITED</span> {v.ruleName} · 위반{" "}
            {v.count}건
          </li>
        ))}
        {result.skipped.map((s) => (
          <li key={s.ruleId} className="muted">
            <span className="type-tag">{s.ruleType}</span> {s.ruleName}
            <small>{s.reason}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DocumentTransform() {
  const [file, setFile] = useState<File | null>(null);
  const [original, setOriginal] = useState("");
  const [result, setResult] = useState<DocumentTransformResult | null>(null);
  const [view, setView] = useState<"after" | "before">("after");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setResult(null);
    setError(
      selected && selected.size > MAX_BYTES
        ? "파일은 1MB 이하여야 합니다."
        : "",
    );
    setFile(selected);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const [text, transformed] = await Promise.all([
        file.text(),
        api<DocumentTransformResult>("/api/transform", {
          method: "POST",
          body,
        }),
      ]);
      setOriginal(text);
      setResult(transformed);
      setView("after");
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            APPLY <span>/ DOCUMENT TRANSFORM</span>
          </div>
          <h1>문서 표준화</h1>
          <p>
            Markdown 문서에 활성 표준 용어와 마스킹 규칙을 적용합니다. 업로드한
            문서는 저장하지 않습니다.
          </p>
        </div>
      </div>
      <section className="panel transform-upload">
        <form onSubmit={submit}>
          <label className="transform-drop">
            <input
              type="file"
              name="file"
              accept=".md,.markdown,text/markdown"
              onChange={choose}
            />
            <span className="transform-drop-icon">↑</span>
            <strong>{file ? file.name : ".md 파일 선택"}</strong>
            <span className="muted small-text">
              {file
                ? `${(file.size / 1024).toFixed(1)} KB`
                : "UTF-8 · 최대 1MB"}
            </span>
          </label>
          <Button
            variant="default"
            className="button primary"
            disabled={!file || loading || file.size > MAX_BYTES}
          >
            {loading ? "적용 중…" : "규칙 적용 →"}
          </Button>
        </form>
      </section>
      {error && <ErrorNotice message={error} />}
      {result && (
        <div className="transform-grid">
          <Report result={result} />
          <section className="panel transform-preview">
            <div className="panel-title">
              <div className="transform-toggle" role="tablist">
                {(["after", "before"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={view === v}
                    onClick={() => setView(v)}
                  >
                    {v === "after" ? "변환 결과" : "원본"}
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                className="button"
                onClick={() => download(result.fileName, result.markdown)}
              >
                다운로드 ↓
              </Button>
            </div>
            <pre>{view === "after" ? result.markdown : original}</pre>
          </section>
        </div>
      )}
    </>
  );
}
