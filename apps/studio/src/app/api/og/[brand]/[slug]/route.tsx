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

  const classification = meta.classification;
  const isSensitive = classification === "confidential" || classification === "restricted" || classification === "Strictly Confidential";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: "64px 72px",
          background: "linear-gradient(135deg, #0f2438 0%, #1f4b6e 60%, #2c6690 100%)",
          color: "#ffffff",
          fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: -0.5,
              opacity: 0.92,
            }}
          >
            {meta.brandName}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 20,
              opacity: 0.75,
            }}
          >
            Docgent
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {meta.doctype && (
            <div
              style={{
                display: "flex",
                fontSize: 22,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 2,
                opacity: 0.7,
              }}
            >
              {meta.doctype}
            </div>
          )}
          <div
            style={{
              display: "flex",
              fontSize: meta.title.length > 60 ? 48 : 60,
              fontWeight: 750,
              lineHeight: 1.08,
              letterSpacing: -1,
              maxWidth: 980,
            }}
          >
            {meta.title}
          </div>
          {meta.subtitle && (
            <div style={{ display: "flex", fontSize: 28, opacity: 0.82, maxWidth: 900 }}>
              {meta.subtitle}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 22 }}>
          {meta.status && (
            <div
              style={{
                display: "flex",
                padding: "8px 18px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.16)",
                textTransform: "capitalize",
              }}
            >
              {meta.status}
            </div>
          )}
          {isSensitive && (
            <div
              style={{
                display: "flex",
                padding: "8px 18px",
                borderRadius: 999,
                background: "rgba(214,80,80,0.35)",
                border: "1px solid rgba(255,255,255,0.3)",
              }}
            >
              {classification}
            </div>
          )}
          {meta.version && (
            <div style={{ display: "flex", opacity: 0.75 }}>v{meta.version}</div>
          )}
          {meta.date && (
            <div style={{ display: "flex", opacity: 0.75, marginLeft: "auto" }}>{meta.date}</div>
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
