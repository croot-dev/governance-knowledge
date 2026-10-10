"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { Block } from "@/domain/ingestion/content";

const regionLabels: Record<string, string> = {
  HEADER: "헤더",
  NAVIGATION: "내비게이션",
  SIDEBAR: "사이드바",
  TAB: "탭",
  FORM: "입력 폼",
  TABLE: "표",
  CHART: "차트",
  IMAGE: "이미지",
  TEXT: "텍스트",
  BUTTON: "버튼",
  LIST: "목록",
  CARD: "카드",
  FOOTER: "푸터",
  OTHER: "기타",
};

interface LayoutViewProps {
  blocks: Block[];
  // Only images have a stored original to draw regions on; PDF pages show the list only.
  imageUrl?: string;
}

export function LayoutView({ blocks, imageUrl }: LayoutViewProps) {
  const [active, setActive] = useState<string | null>(null);
  const pages = [...new Set(blocks.map((b) => b.location.page ?? 1))];
  if (!blocks.length)
    return (
      <p className="doc-empty">
        레이아웃 설명이 없습니다. 추출 참고사항에서 사유를 확인하세요.
      </p>
    );
  return (
    <div className="doc-layout">
      <p className="doc-caption">
        비전 모델이 해석한 화면 구성입니다. 원문 텍스트가 아니며 용어 연결·규칙
        판정의 근거로 쓰지 않습니다. 영역 좌표는 모델 추정값입니다.
      </p>
      {pages.map((page) => {
        const onPage = blocks.filter((b) => (b.location.page ?? 1) === page);
        const summary = onPage.find((b) => b.kind === "VISUAL_SUMMARY");
        const regions = onPage.filter((b) => b.kind === "VISUAL_REGION");
        const showImage = imageUrl && page === 1;
        return (
          <section key={page} className="doc-layout-page">
            {pages.length > 1 && <h3>{page}쪽</h3>}
            {summary && <p className="doc-layout-summary">{summary.text}</p>}
            <div className={showImage ? "doc-layout-grid" : undefined}>
              {showImage && (
                <figure className="doc-layout-figure">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private API image, not a static asset */}
                  <img src={imageUrl} alt="업로드한 원본 이미지" />
                  {regions.map((region) => {
                    const [x1, y1, x2, y2] = region.visual!.bbox ?? [
                      0, 0, 0, 0,
                    ];
                    if (x2 <= x1 || y2 <= y1) return null;
                    return (
                      <span
                        key={region.id}
                        aria-hidden="true"
                        className={`doc-layout-box ${active === region.id ? "active" : ""}`}
                        style={{
                          left: `${x1 / 10}%`,
                          top: `${y1 / 10}%`,
                          width: `${(x2 - x1) / 10}%`,
                          height: `${(y2 - y1) / 10}%`,
                        }}
                      />
                    );
                  })}
                </figure>
              )}
              <ol className="doc-layout-regions">
                {regions.map((region) => (
                  <li key={region.id}>
                    <button
                      type="button"
                      className={active === region.id ? "active" : undefined}
                      onMouseEnter={() => setActive(region.id)}
                      onMouseLeave={() => setActive(null)}
                      onFocus={() => setActive(region.id)}
                      onBlur={() => setActive(null)}
                    >
                      <Badge variant="outline">
                        {regionLabels[region.visual?.regionType ?? "OTHER"]}
                      </Badge>
                      <span>{region.text}</span>
                    </button>
                  </li>
                ))}
                {!regions.length && (
                  <li className="muted">인식된 영역이 없습니다.</li>
                )}
              </ol>
            </div>
          </section>
        );
      })}
    </div>
  );
}
