"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Profile } from "@/domain/model";
const links = [
  ["terms", "표준 용어", "T"],
  ["expressions", "표현 · 별칭", "E"],
  ["rules", "거버넌스 규칙", "R"],
  ["search", "시맨틱 검색", "⌕"],
  ["transform", "문서 표준화", "↻"],
];
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [provider, setProvider] = useState("확인 중");
  useEffect(() => {
    api<{ profile: Profile }>("/api/config")
      .then((r) => setProvider(r.profile.provider))
      .catch(() => setProvider("연결 오류"));
  }, []);
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link className="brand" href="/governance/terms">
          <span className="brand-mark">
            g<span>·</span>
          </span>
          <span>
            Governance<small>KNOWLEDGE WORKSPACE</small>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-icon">G</span>
          <div>
            거버넌스 지식 관리<small>Local workspace</small>
          </div>
          <span className="chevron">⌄</span>
        </div>
        <p className="nav-caption">KNOWLEDGE LIBRARY</p>
        <nav aria-label="주 메뉴">
          {links.map(([slug, label, icon]) => (
            <Link
              key={slug}
              href={`/governance/${slug}`}
              className={
                pathname.startsWith(`/governance/${slug}`)
                  ? "nav-link active"
                  : "nav-link"
              }
            >
              <span className="nav-icon">{icon}</span>
              {label}
              {slug === "search" && <span className="nav-tag">AI</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="provider-dot" /> 로컬 개발 환경{" "}
          <span className="provider-label">{provider}</span>
          <p>
            용어에서 규칙까지,
            <br />
            일관된 데이터의 기준을 만드세요.
          </p>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span> Governance
          </span>
          <span className="environment">
            <i /> Local · MVP
          </span>
        </header>
        <main>{children}</main>
        <footer>
          Governance Knowledge <span>PostgreSQL · LanceDB</span>
        </footer>
      </div>
    </div>
  );
}
