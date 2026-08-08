import Link from "next/link";
import type { DocSummary } from "@/lib/store";

export function Sidebar({
  documents,
  activeSlug,
  activeBrand,
}: {
  documents: DocSummary[];
  activeBrand?: string;
  activeSlug?: string;
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

      {byBrand.size === 0 && (
        <div className="empty" style={{ padding: "28px 20px", fontSize: 13 }}>
          No documents found.
        </div>
      )}

      {[...byBrand.entries()].map(([brand, docs]) => (
        <div className="brand-group" key={brand}>
          <div className="brand-label">{brand}</div>
          {docs.map((d) => (
            <Link
              key={d.path}
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
    </aside>
  );
}
