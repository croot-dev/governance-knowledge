"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Profile } from "@/domain/model";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  tag?: string;
}
interface NavSection {
  caption: string;
  crumb: string;
  items: NavItem[];
}

// Documents are the main flow; governance is the reference data they are checked against.
const sections: NavSection[] = [
  {
    caption: "DOCUMENTS",
    crumb: "Documents",
    items: [{ href: "/documents", label: "문서 워크스페이스", icon: "D" }],
  },
  {
    caption: "GOVERNANCE",
    crumb: "Governance",
    items: [
      { href: "/governance/terms", label: "표준 용어", icon: "T" },
      { href: "/governance/expressions", label: "표현 · 별칭", icon: "E" },
      { href: "/governance/rules", label: "거버넌스 규칙", icon: "R" },
    ],
  },
  {
    caption: "TOOLS",
    crumb: "Tools",
    items: [
      {
        href: "/governance/search",
        label: "시맨틱 검색",
        icon: "⌕",
        tag: "AI",
      },
      { href: "/governance/transform", label: "MD 빠른 표준화", icon: "↻" },
    ],
  },
];

function activeItem(pathname: string) {
  for (const section of sections)
    for (const item of section.items)
      if (pathname === item.href || pathname.startsWith(`${item.href}/`))
        return { section, item };
  return null;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [provider, setProvider] = useState("확인 중");
  useEffect(() => {
    api<{ profile: Profile }>("/api/config")
      .then((r) => setProvider(r.profile.provider))
      .catch(() => setProvider("연결 오류"));
  }, []);
  const active = activeItem(pathname);
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link className="brand" href="/documents">
          <span className="brand-mark">
            d<span>·</span>
          </span>
          <span>
            Enrichment<small>DOCUMENT WORKSPACE</small>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-icon">G</span>
          <div>
            문서 보강 · 거버넌스<small>Local workspace</small>
          </div>
        </div>
        <nav aria-label="주 메뉴">
          {sections.map((section) => (
            <div key={section.caption} className="nav-section">
              <p className="nav-caption">{section.caption}</p>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active?.item === item ? "page" : undefined}
                  className={
                    active?.item === item ? "nav-link active" : "nav-link"
                  }
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                  {item.tag && <span className="nav-tag">{item.tag}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="provider-dot" /> 임베딩{" "}
          <span className="provider-label">{provider}</span>
          <p>
            문서를 모으고 추출해,
            <br />
            회사의 기준과 연결하세요.
          </p>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span>{" "}
            {active?.section.crumb ?? "Documents"}
            {active && (
              <>
                {" "}
                <span className="slash">/</span> {active.item.label}
              </>
            )}
          </span>
          <span className="environment">
            <i /> Local · MVP
          </span>
        </header>
        <main>{children}</main>
        <footer>
          Document Enrichment <span>PostgreSQL · LanceDB · Artifact Store</span>
        </footer>
      </div>
    </div>
  );
}
