import Link from "next/link";
import type { DocSummary } from "@/lib/store";

/**
 * Documents grouped by brand.
 *
 * Each brand is its own repository, so the grouping here is not cosmetic —
 * it is the boundary that decides which store a document came from. The
 * sidebar spans every brand so switching between them never requires
 * going back to the index.
 *
 * Entries are labelled with the document's frontmatter title. The slug is the
 * address, not the name, and showing an address where a name belongs is what
 * made this list hard to scan.
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
  const byBrand = new Map<string, DocSummary[]>();
  for (const d of documents) {
    if (!byBrand.has(d.brand)) byBrand.set(d.brand, []);
    byBrand.get(d.brand)!.push(d);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Link href="/" className="wordmark" style={{ color: "inherit" }}>
          <img src="/docgent-logo.svg" alt="Docgent" className="wordmark-logo" />
        </Link>
        <div className="wordmark-sub">Studio</div>
      </div>

      {byBrand.size === 0 && errors.length === 0 && (
        <div className="empty" style={{ padding: "28px 20px", fontSize: 13 }}>
          No documents found.
        </div>
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
              title={
                d.frontmatter?.status
                  ? `${d.title} — ${d.frontmatter.status}`
                  : d.title
              }
            >
              <span className="doc-link-title">
                {/* Lifecycle state, carried by the same data-status contract the
                    badges elsewhere use, so a colour means one thing across the
                    whole app. Documents with no status get no dot rather than a
                    neutral one: absence of a state and a state called "none"
                    are different claims, and only one of them is true. */}
                {d.frontmatter?.status && (
                  <span
                    className="doc-link-dot"
                    data-status={d.frontmatter.status}
                    aria-hidden="true"
                  />
                )}
                <span className="doc-link-name">{d.title}</span>
              </span>
              {(d.frontmatter?.status || d.frontmatter?.date || d.assets.length > 0) && (
                <span className="doc-link-meta">
                  {[
                    d.frontmatter?.status ? String(d.frontmatter.status) : null,
                    d.frontmatter?.date ? String(d.frontmatter.date) : null,
                    d.assets.length > 0
                      ? `${d.assets.length} asset${d.assets.length > 1 ? "s" : ""}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </Link>
          ))}
        </div>
      ))}

      {/* A store we cannot read is named rather than silently omitted, so an
          empty brand is never mistaken for a brand with no documents. */}
      {errors.map((e) => (
        <div className="brand-group" key={`err-${e.brand}`}>
          <div className="brand-label">{e.brand}</div>
          <div
            className="doc-link-meta"
            style={{ padding: "2px 20px 10px", display: "block" }}
          >
            unavailable
          </div>
        </div>
      ))}
    </aside>
  );
}
