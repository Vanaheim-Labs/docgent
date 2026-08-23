import { ImageResponse } from "@vercel/og";
import { fetchDocPreviewMeta } from "@/lib/metadata";
import { getBrandTheme } from "@/lib/brand-theme";

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
 *
 * The image is visually branded per brand:
 * - Background gradient derived from the brand's `band` + `accent` palette
 * - Accent bar at the top uses the brand accent colour
 * - Brand logo embedded when available (fetched from docgent-brands repo)
 * - Falls back to brand name text when no logo is present
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const { brand, slug } = await ctx.params;
  const ref = new URL(req.url).searchParams.get("v") || undefined;

  // Fetch doc metadata and brand theme in parallel
  const [meta, theme] = await Promise.all([
    fetchDocPreviewMeta(brand, slug, ref),
    getBrandTheme(brand, true),
  ]);

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

  const { palette, darkBand, logoDataUri } = theme;
  const { band, accent, ink: inkColor, paper } = palette;

  // On dark band: text is white; on light band: text is the brand ink colour
  const textColor = darkBand ? "#ffffff" : inkColor;
  const textMuted = darkBand ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.45)";
  const textFaint = darkBand ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.35)";
  const textBody = darkBand ? "rgba(255,255,255,0.72)" : "rgba(0,0,0,0.65)";
  const pillBg = darkBand ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  const pillBorder = darkBand ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.14)";
  const dividerColor = darkBand ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

  // Derive a slightly lightened/darkened mid-stop for the gradient
  // by blending band toward accent. We do this purely with CSS since
  // we can't do colour math in JSX easily.
  const gradientMid = accent + "44"; // accent at 27% opacity over band

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          background: darkBand
            ? `linear-gradient(145deg, ${band} 0%, ${band}ee 45%, ${accent}33 100%)`
            : `linear-gradient(145deg, ${paper} 0%, ${paper} 60%, ${accent}18 100%)`,
          color: textColor,
          fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
          position: "relative",
        }}
      >
        {/* Brand accent bar at top */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 5,
            background: `linear-gradient(90deg, ${accent} 0%, ${accent}99 100%)`,
            display: "flex",
          }}
        />

        {/* Header: logo (or brand name) + Docgent wordmark */}
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
              gap: 14,
            }}
          >
            {/* Logo or brand name text */}
            {logoDataUri ? (
              <img
                src={logoDataUri}
                style={{
                  height: 36,
                  maxWidth: 180,
                  objectFit: "contain",
                  objectPosition: "left center",
                }}
                alt={meta.brandName}
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  fontSize: 28,
                  fontWeight: 700,
                  letterSpacing: -0.5,
                  color: textColor,
                }}
              >
                {meta.brandName}
              </div>
            )}
            {meta.doctype && (
              <>
                <div style={{ display: "flex", opacity: 0.3, fontSize: 22, color: textColor }}>·</div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 15,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: 1.5,
                    color: textMuted,
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
              fontSize: 17,
              fontWeight: 500,
              color: textFaint,
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
              color: textColor,
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
                color: textBody,
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
                color: textMuted,
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
            borderTop: `1px solid ${dividerColor}`,
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
                background: pillBg,
                border: `1px solid ${pillBorder}`,
                fontSize: 18,
                fontWeight: 600,
                textTransform: "capitalize",
                letterSpacing: 0.3,
                color: textColor,
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
                background: darkBand ? "rgba(200,60,60,0.3)" : "rgba(200,60,60,0.1)",
                border: `1px solid ${darkBand ? "rgba(255,100,100,0.4)" : "rgba(180,60,60,0.3)"}`,
                fontSize: 18,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                color: darkBand ? "rgba(255,180,180,1)" : "#b91c1c",
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
                color: textFaint,
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
                color: textFaint,
                fontWeight: 500,
              }}
            >
              {meta.client}
            </div>
          )}
          {/* Accent dot — a small brand colour signal in the footer */}
          <div
            style={{
              display: "flex",
              width: 8,
              height: 8,
              borderRadius: 4,
              background: accent,
              marginLeft: 4,
              opacity: 0.7,
            }}
          />
          {meta.date && (
            <div
              style={{
                display: "flex",
                fontSize: 18,
                color: textFaint,
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
