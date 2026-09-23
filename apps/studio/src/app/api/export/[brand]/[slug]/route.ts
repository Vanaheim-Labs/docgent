import { storesFor } from "@/lib/store";
import { collectAssetsFromGit } from "@/lib/render";
import { authorizeRequest } from "@/lib/agent-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Exports a document to DOCX via the render worker's /export/docx endpoint.
 *
 * Only ?format=docx is supported — DOCX is the only non-PDF export format
 * at this time. The DOCX pipeline reuses the same pandoc pre-processing
 * (vocabulary Lua filter, microtype, frontmatter) but outputs .docx directly,
 * skipping WeasyPrint and all HTML/CSS styling.
 *
 * No caching: DOCX export is an on-demand operation.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const { brand, slug } = await ctx.params;

  const authz = await authorizeRequest(req, brand);
  if (!authz.ok) return new Response("unauthorised", { status: 401 });

  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format");
  if (format !== "docx") {
    return Response.json(
      { error: "Unsupported format. Supported: docx" },
      { status: 400 }
    );
  }

  const url = process.env.DOCGENT_RENDER_URL;
  const key = process.env.DOCGENT_API_KEY;
  if (!url) return new Response("DOCGENT_RENDER_URL is not set", { status: 500 });
  if (!key) return new Response("DOCGENT_API_KEY is not set", { status: 500 });

  try {
    const { git, docs } = await storesFor(brand);
    const commitSha = await git.head();
    const doc = await docs.readAt(brand, slug, commitSha);

    // Collect assets (assets/ and figures/) the same way the PDF route does.
    const dir = `documents/${slug}`;
    const assetPaths: string[] = [];
    for (const prefix of [`${dir}/assets/`, `${dir}/figures/`]) {
      try {
        const tree = await git.tree({ ref: commitSha, prefix });
        for (const e of tree.entries as { type: string; path: string }[]) {
          if (e.type === "file") assetPaths.push(e.path.slice(dir.length + 1));
        }
      } catch {
        // missing directory is fine
      }
    }

    // Strip SVG assets: pandoc requires rsvg-convert to embed SVGs into DOCX,
    // which is not installed on the render-worker. Sending SVGs causes pandoc
    // to hang at 100% CPU for the full process timeout. The Lua filter replaces
    // any SVG Image nodes with a text placeholder, so stripping them here is
    // belt-and-suspenders — the file must not reach the temp dir at all or
    // pandoc will still try to resolve it before the filter runs.
    const docxAssetPaths = assetPaths.filter(p => !/\.svg$/i.test(p));
    const assets = await collectAssetsFromGit(git, dir, docxAssetPaths, commitSha);
    const brandId = doc.frontmatter?.brand || brand;

    const res = await fetch(`${url.replace(/\/$/, "")}/export/docx`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Docgent-Key": key,
      },
      body: JSON.stringify({ markdown: doc.content, brand: brandId, assets }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const j = await res.json();
        if (j?.error) detail = j.error;
      } catch {}
      return new Response(`export failed — ${detail}`, {
        status: 502,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const docx = await res.arrayBuffer();
    const renderMs = res.headers.get("x-docgent-render-ms") ?? "";

    return new Response(new Uint8Array(docx), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${slug}.docx"`,
        "Cache-Control": "no-store",
        "X-Docgent-Render-Ms": renderMs,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`export failed: ${msg}`, {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
