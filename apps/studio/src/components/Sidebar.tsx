import Link from "next/link";
import type { DocSummary } from "@/lib/store";

/**
 * Documents grouped by brand.
 *
 * Each brand is its own repository, so the grouping here is not cosmetic —
 * it is the boundary that decides which store a document came from. The
 * sidebar spans every brand so switching between them never requires
 * going back to the index.
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
          <span className="wordmark-dot" />
          DocForge
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
            {brand}
          </div>
          {docs.map((d) => (
            <Link
              key={`${d.brand}/${d.slug}`}
              href={`/${d.brand}/${d.slug}`}
              className="doc-link"
              data-active={d.brand === activeBrand && d.slug === activeSlug}
            >
              <span className="doc-link-title">{d.slug}</span>
              {d.assets.length > 0 && (
                <span className="doc-link-meta">
                  {d.assets.length} asset{d.assets.length > 1 ? "s" : ""}
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
