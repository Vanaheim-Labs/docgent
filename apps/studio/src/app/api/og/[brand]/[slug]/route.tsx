import { ImageResponse } from "@vercel/og";
import { fetchDocPreviewMeta } from "@/lib/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dynamic 1200x630 OG image for a document, referenced by generateMetadata
 * in the [brand]/[slug] page. Unauthenticated by design - the same crawler
 * that fetches a page's <head> tags fetches its og:image URL as a separate,
 * un-cookied request, so this cannot depend on a session either. See
 * lib/metadata.ts for what is and is not safe to put in this image.
 *
 * A commit-pinned view (`?v=<sha>`) renders that revision's metadata, same
 * as the page itself, so a shared link and its preview image always agree.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const { brand, slug } = await ctx.params;
  const ref = new URL(req.url).searchParams.get("v") || undefined;

  const meta = await fetchDocPreviewMeta(brand, slug, ref);
  if (!meta) {
    return new Response("not found", { status: 404 });
  }

  const classification = meta.classification?.toLowerCase();
  const isSensitive =
    classification === "confidential" ||
    classification === "restricted" ||
    classification === "strictly confidential";

  const versionLabel = meta.version
    ? meta.version.startsWith("v")
      ? meta.version
      : `v${meta.version}`
    : null;

  // Clamp title font size: very long titles drop to 40px to stay on 2 lines
  const titleFontSize = meta.title.length > 80 ? 40 : meta.title.length > 55 ? 48 : 60;

  // Show description snippet only if it's genuinely informative (not just the fallback)
  const showDescription =
    meta.description && meta.description !== "A Docgent document." && !meta.subtitle;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          background: "linear-gradient(145deg, #0b1e30 0%, #163652 55%, #1e5278 100%)",
          color: "#ffffff",
          fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
          position: "relative",
        }}
      >
        {/* Subtle top accent bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            background: "linear-gradient(90deg, #4a9eda 0%, #2d7cbf 50%, #1a5c9a 100%)",
            display: "flex",
          }}
        />

        {/* Header: brand name + Docgent wordmark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "52px 72px 0",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: -0.5,
                color: "#ffffff",
              }}
            >
              {meta.brandName}
            </div>
            {meta.doctype && (
              <>
                <div style={{ display: "flex", opacity: 0.35, fontSize: 24 }}>·</div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 16,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: 1.5,
                    color: "rgba(255,255,255,0.55)",
                    paddingTop: 3,
                  }}
                >
                  {meta.doctype}
                </div>
              </>
            )}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 18,
              fontWeight: 500,
              color: "rgba(255,255,255,0.4)",
              letterSpacing: 0.5,
            }}
          >
            docs.docgent.io
          </div>
        </div>

        {/* Main content: title + subtitle/description */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            padding: "0 72px",
            flex: 1,
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: titleFontSize,
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: -1.5,
              color: "#ffffff",
              maxWidth: 1000,
            }}
          >
            {meta.title}
          </div>
          {meta.subtitle && (
            <div
              style={{
                display: "flex",
                fontSize: 26,
                lineHeight: 1.4,
                color: "rgba(255,255,255,0.72)",
                maxWidth: 900,
              }}
            >
              {meta.subtitle}
            </div>
          )}
          {showDescription && (
            <div
              style={{
                display: "flex",
                fontSize: 22,
                lineHeight: 1.5,
                color: "rgba(255,255,255,0.58)",
                maxWidth: 860,
              }}
            >
              {meta.description.length > 120
                ? meta.description.slice(0, 117) + "…"
                : meta.description}
            </div>
          )}
        </div>

        {/* Footer: status, classification, version, date */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 72px 52px",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            paddingTop: 24,
            marginTop: 24,
          }}
        >
          {meta.status && (
            <div
              style={{
                display: "flex",
                padding: "7px 16px",
                borderRadius: 6,
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.18)",
                fontSize: 18,
                fontWeight: 600,
                textTransform: "capitalize",
                letterSpacing: 0.3,
              }}
            >
              {meta.status}
            </div>
          )}
          {isSensitive && (
            <div
              style={{
                display: "flex",
                padding: "7px 16px",
                borderRadius: 6,
                background: "rgba(200,60,60,0.3)",
                border: "1px solid rgba(255,100,100,0.4)",
                fontSize: 18,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                color: "rgba(255,180,180,1)",
              }}
            >
              {meta.classification}
            </div>
          )}
          {versionLabel && (
            <div
              style={{
                display: "flex",
                fontSize: 18,
                color: "rgba(255,255,255,0.45)",
                fontWeight: 500,
              }}
            >
              {versionLabel}
            </div>
          )}
          {meta.client && (
            <div
              style={{
                display: "flex",
                fontSize: 18,
                color: "rgba(255,255,255,0.45)",
                fontWeight: 500,
              }}
            >
              {meta.client}
            </div>
          )}
          {meta.date && (
            <div
              style={{
                display: "flex",
                fontSize: 18,
                color: "rgba(255,255,255,0.4)",
                marginLeft: "auto",
              }}
            >
              {meta.date}
            </div>
          )}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": ref
          ? "public, max-age=31536000, immutable"
          : "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      },
    }
  );
}
