import type { DocPreviewMeta } from "@/lib/metadata";
import { getBrandTheme } from "@/lib/brand-theme";

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
 *
 * Branded: the hero header uses the brand's palette and logo so the page
 * feels like the brand that owns the document, not a generic Docgent page.
 */
export async function SignInPreview({
  meta,
  brand,
  slug,
}: {
  meta: DocPreviewMeta;
  brand: string;
  slug: string;
}) {
  const returnTo = `/${brand}/${slug}`;
  const theme = await getBrandTheme(brand, true);
  const { palette, darkBand, logoDataUri } = theme;
  const { band, accent } = palette;

  const isSensitive =
    meta.classification?.toLowerCase() === "confidential" ||
    meta.classification?.toLowerCase() === "restricted" ||
    meta.classification?.toLowerCase() === "strictly confidential";

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#f4f6f8" }}>

      {/* ── Brand hero header ─────────────────────────────────────────────── */}
      <div
        style={{
          background: darkBand
            ? `linear-gradient(135deg, ${band} 0%, ${band}ee 60%, ${accent}44 100%)`
            : `linear-gradient(135deg, ${band} 0%, ${band}dd 100%)`,
          borderBottom: `3px solid ${accent}`,
          padding: "28px 40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {logoDataUri ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={logoDataUri}
              alt={meta.brandName}
              style={{ height: 36, maxWidth: 160, objectFit: "contain", objectPosition: "left center" }}
            />
          ) : (
            <span
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: darkBand ? "#ffffff" : "#ffffff",
                letterSpacing: -0.3,
              }}
            >
              {meta.brandName}
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: 13,
            color: darkBand ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.6)",
            letterSpacing: 0.3,
          }}
        >
          docs.docgent.io
        </span>
      </div>

      {/* ── Doc card ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
        <div
          style={{
            background: "#ffffff",
            borderRadius: 12,
            boxShadow: "0 2px 16px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)",
            maxWidth: 540,
            width: "100%",
            overflow: "hidden",
          }}
        >
          {/* Card accent top strip */}
          <div style={{ height: 4, background: accent }} />

          <div style={{ padding: "28px 32px 32px" }}>
            {/* Doctype eyebrow */}
            {meta.doctype && (
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 1.5,
                  color: accent,
                  marginBottom: 10,
                }}
              >
                {meta.doctype}
              </div>
            )}

            {/* Title + subtitle */}
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 4px", color: "#0f1923", lineHeight: 1.2, letterSpacing: -0.5 }}>
              {meta.title}
            </h1>
            {meta.subtitle && (
              <p style={{ margin: "0 0 20px", fontSize: 16, color: "#667788", fontWeight: 400 }}>
                {meta.subtitle}
              </p>
            )}
            {!meta.subtitle && <div style={{ marginBottom: 20 }} />}

            {/* Meta chips row */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              {meta.version && <MetaChip k="Version" v={meta.version} />}
              {meta.date && <MetaChip k="Date" v={meta.date} />}
              {meta.client && <MetaChip k="Client" v={meta.client} />}
              {meta.author && <MetaChip k="Author" v={meta.author} />}
            </div>

            {/* Status + classification badges */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              {meta.status && <StatusBadge status={meta.status} accent={accent} />}
              {isSensitive && meta.classification && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "4px 10px",
                    borderRadius: 5,
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                    background: "rgba(185,28,28,0.08)",
                    color: "#b91c1c",
                    border: "1px solid rgba(185,28,28,0.2)",
                  }}
                >
                  {meta.classification}
                </span>
              )}
            </div>

            {/* Description */}
            {meta.description && meta.description !== "A Docgent document." && (
              <p style={{ margin: "0 0 28px", fontSize: 14, lineHeight: 1.65, color: "#556", borderTop: "1px solid #eef0f3", paddingTop: 16 }}>
                {meta.description}
              </p>
            )}

            {/* CTA */}
            <a
              href={`/signin?callbackUrl=${encodeURIComponent(returnTo)}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "11px 22px",
                borderRadius: 7,
                fontSize: 14,
                fontWeight: 700,
                textDecoration: "none",
                background: accent,
                color: "#ffffff",
                letterSpacing: 0.2,
              }}
            >
              Sign in to view →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaChip({ k, v }: { k: string; v: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 10px",
        borderRadius: 5,
        fontSize: 12,
        background: "#f2f4f7",
        border: "1px solid #e2e6eb",
        color: "#444",
      }}
    >
      <span style={{ fontWeight: 600, color: "#888", textTransform: "uppercase", fontSize: 10, letterSpacing: 0.8 }}>{k}</span>
      <span style={{ fontWeight: 500 }}>{v}</span>
    </span>
  );
}

function StatusBadge({ status, accent }: { status: string; accent: string }) {
  const s = status.toLowerCase();
  let bg = "#f2f4f7", color = "#555", border = "#e2e6eb";
  if (s === "draft") { bg = "#fff8e6"; color = "#a35b12"; border = "#f0dfa0"; }
  if (s === "review") { bg = "#eff8ff"; color = "#1a6fa8"; border = "#c0ddf5"; }
  if (s === "approved" || s === "released") { bg = "#edfaf3"; color = "#15804d"; border = "#a8e0c4"; }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: 5,
        fontSize: 12,
        fontWeight: 700,
        textTransform: "capitalize",
        background: bg,
        color,
        border: `1px solid ${border}`,
      }}
    >
      {status}
    </span>
  );
}
