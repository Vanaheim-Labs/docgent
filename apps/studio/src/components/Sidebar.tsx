"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import type { DocSummary } from "@/lib/store";

/**
 * Sidebar nav.
 *
 * On document pages (activeBrand + activeSlug set), auto-collapses to a slim
 * icon rail so the document fills the viewport. User can expand via the toggle.
 * On home/library, starts expanded.
 */
export function Sidebar({
  documents,
  activeSlug,
  activeBrand,
  errors = [],
}: {
  documents: DocSummary[];
  activeBrand?: string;
  activeSlug?: string;
  errors?: { brand: string; message: string }[];
}) {
  const isDocPage = !!(activeBrand && activeSlug);
  const [collapsed, setCollapsed] = useState(isDocPage);

  const byBrand = new Map<string, DocSummary[]>();
  for (const d of documents) {
    if (!byBrand.has(d.brand)) byBrand.set(d.brand, []);
    byBrand.get(d.brand)!.push(d);
  }

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isHome = pathname === "/";
  const bucketParam = searchParams?.get("bucket") ?? null;
  const isReviewActive = isHome && bucketParam === "needs-review";
  const isAgentActivityActive = isHome && bucketParam === "in-progress";
  const isAllDocsActive = isHome && !bucketParam;

  return (
    <aside className="sidebar" data-collapsed={collapsed}>
      <div className="sidebar-head">
        <Link href="/" className="wordmark" style={{ color: "inherit" }} title="Docgent Studio">
          <img src="/docgent-logo.svg" alt="Docgent" className="wordmark-logo" />
        </Link>
        {!collapsed && <div className="wordmark-sub">Studio</div>}
        <button
          className="sidebar-collapse-btn"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      {collapsed ? (
        <nav className="sidebar-icon-rail" aria-label="Navigation">
          <Link href="/" className="sidebar-icon-btn" title="All documents" data-active={isAllDocsActive}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            </svg>
          </Link>
          <Link href="/?bucket=needs-review" className="sidebar-icon-btn" title="Needs review" data-active={isReviewActive}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </Link>
          <Link href="/?bucket=in-progress" className="sidebar-icon-btn" title="In progress" data-active={isAgentActivityActive}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </Link>
        </nav>
      ) : (
        <>
          <div className="nav-section">
            <div className="nav-section-head">Work</div>
            <Link href="/?bucket=needs-review" className="nav-item" data-active={isReviewActive}>Review</Link>
            <Link href="/?bucket=in-progress" className="nav-item" data-active={isAgentActivityActive}>Agent activity</Link>
          </div>
          <div className="nav-section">
            <div className="nav-section-head">Library</div>
            <Link href="/" className="nav-item" data-active={isAllDocsActive}>All documents</Link>
          </div>

          {byBrand.size === 0 && errors.length === 0 && (
            <div className="empty" style={{ padding: "28px 20px", fontSize: 13 }}>No documents found.</div>
          )}

          {[...byBrand.entries()].map(([brand, docs]) => (
            <div className="brand-group" key={brand}>
              <div className="brand-label" data-active={brand === activeBrand}>
                {docs[0]?.brandName || brand}
              </div>
              {docs.map((d) => (
                <Link
                  key={`${d.brand}/${d.slug}`}
                  href={`/${d.brand}/${d.slug}`}
                  className="doc-link"
                  data-active={d.brand === activeBrand && d.slug === activeSlug}
                  title={d.frontmatter?.status ? `${d.title} — ${d.frontmatter.status}` : d.title}
                >
                  <span className="doc-link-title">
                    {d.frontmatter?.status && (
                      <span className="doc-link-dot" data-status={d.frontmatter.status} aria-hidden="true" />
                    )}
                    <span className="doc-link-name">{d.title}</span>
                  </span>
                  {(d.frontmatter?.status || d.frontmatter?.date || d.assets.length > 0) && (
                    <span className="doc-link-meta">
                      {[
                        d.frontmatter?.status ? String(d.frontmatter.status) : null,
                        d.frontmatter?.date ? String(d.frontmatter.date) : null,
                        d.assets.length > 0 ? `${d.assets.length} asset${d.assets.length > 1 ? "s" : ""}` : null,
                      ].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ))}

          {errors.map((e) => (
            <div className="brand-group" key={`err-${e.brand}`}>
              <div className="brand-label">{e.brand}</div>
              <div className="doc-link-meta" style={{ padding: "2px 20px 10px", display: "block" }}>unavailable</div>
            </div>
          ))}
        </>
      )}
    </aside>
  );
}
