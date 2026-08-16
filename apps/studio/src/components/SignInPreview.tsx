import type { DocPreviewMeta } from "@/lib/metadata";

/**
 * What an unauthenticated visitor sees at /:brand/:slug - a human who has
 * not signed in yet, or a link-preview crawler that never will.
 *
 * Deliberately shows only what generateMetadata (page.tsx) already put in
 * <head> for the same request - title, doctype, status, classification,
 * a short description - never the document body. A crawler only reads
 * <head> tags anyway; this exists so a human clicking the same link before
 * signing in sees a page that matches the preview they were shown, rather
 * than a bare "sign in" wall with no context for what they are signing in
 * to see.
 */
export function SignInPreview({
  meta,
  brand,
  slug,
}: {
  meta: DocPreviewMeta;
  brand: string;
  slug: string;
}) {
  const returnTo = `/${brand}/${slug}`;

  return (
    <div className="shell" style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: 520, width: "100%", padding: "0 24px" }}>
        <div className="panel">
          <div className="panel-head">
            {meta.brandName} · Docgent
          </div>
          <div className="panel-body">
            <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>{meta.title}</h1>
            {meta.subtitle && (
              <p style={{ margin: "0 0 12px", color: "var(--muted, #667)" }}>{meta.subtitle}</p>
            )}

            <div className="doc-meta-strip" style={{ marginBottom: 16 }}>
              {meta.doctype && <MetaChip k="Type" v={meta.doctype} />}
              {meta.version && <MetaChip k="Version" v={meta.version} />}
              {meta.date && <MetaChip k="Date" v={meta.date} />}
              {meta.client && <MetaChip k="Client" v={meta.client} />}
              {meta.author && <MetaChip k="Author" v={meta.author} />}
              <span className="badge" data-status={meta.status}>{meta.status || "—"}</span>
              <span className="badge" data-class={meta.classification}>
                {meta.classification || "—"}
              </span>
            </div>

            <p style={{ margin: "0 0 20px" }}>{meta.description}</p>

            <a
              className="badge"
              data-status="review"
              style={{ display: "inline-block", padding: "8px 16px", fontSize: 14 }
              }
              href={`/signin?callbackUrl=${encodeURIComponent(returnTo)}`}
            >
              Sign in to view →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaChip({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <span className="meta-chip">
      <span className="meta-chip-key">{k}</span>
      <span className="meta-chip-val">{v}</span>
    </span>
  );
}
