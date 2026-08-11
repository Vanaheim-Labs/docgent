import Link from "next/link";
import type { DocSummary } from "@/lib/store";

/**
 * One document in the index.
 *
 * Shows what the document says about itself — title, subtitle, type, status —
 * rather than where it happens to sit on disk. The repo path is deliberately
 * absent: it is an implementation detail of the store, and someone choosing a
 * document to open has no use for it. Slug and path remain the routing key,
 * not the label.
 */
export function DocCard({ doc }: { doc: DocSummary }) {
  const fm = doc.frontmatter || {};

  // Status and classification are the two fields worth interrupting the eye
  // for: one says whether the document is finished, the other says who may
  // see it. Everything else reads as quiet supporting detail.
  const status = fm.status?.trim();
  const classification = fm.classification?.trim();

  const facts = [
    fm.doctype ? label(fm.doctype) : null,
    fm.version ? `v${String(fm.version).replace(/^v/i, "")}` : null,
    fm.date ? String(fm.date) : null,
    fm.author ? String(fm.author) : null,
    doc.assets.length > 0
      ? `${doc.assets.length} asset${doc.assets.length > 1 ? "s" : ""}`
      : null,
  ].filter(Boolean) as string[];

  return (
    <Link href={`/${doc.brand}/${doc.slug}`} className="doc-card">
      <div className="doc-card-top">
        <h3 className="doc-card-title">{doc.title}</h3>
        <div className="doc-card-badges">
          {status && (
            <span className="badge" data-status={status.toLowerCase()}>
              {label(status)}
            </span>
          )}
          {classification && (
            <span className="badge" data-class={classification.toLowerCase()}>
              {label(classification)}
            </span>
          )}
        </div>
      </div>

      {fm.subtitle && <p className="doc-card-sub">{String(fm.subtitle)}</p>}

      {facts.length > 0 && (
        <div className="doc-card-facts">
          {facts.map((f, i) => (
            <span key={i} className="doc-card-fact">
              {f}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

/** `strategic-report` reads as `Strategic report` to a human. */
function label(v: string) {
  const s = String(v).replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
