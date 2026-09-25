import { storesFor } from "@/lib/store";
import { renderMarkdown, collectAssetsFromGit } from "@/lib/render";
import { pdfStore, cacheKey, cacheDriver } from "@/lib/pdf-cache";
import { authorizeRequest } from "@/lib/agent-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Renders a document to PDF via the Phase 2 worker.
 *
 * ?ref=<commitSha> renders a historical version, which is what makes the
 * version timeline clickable. Without a ref we render current HEAD.
 *
 * All statuses use the legacy preview cache. Cache misses regenerate using
 * pinned source/assets and the current renderer/templates. These PDFs are
 * previews, not archived originals or evidence of what was previously issued.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const { brand, slug } = await ctx.params;

  const authz = await authorizeRequest(req, brand);
  if (!authz.ok) return new Response("unauthorised", { status: 401 });

  const ref = new URL(req.url).searchParams.get("ref") || undefined;
  if (ref && !/^[a-f0-9]{40}$/.test(ref)) return Response.json({ error: "Use a full immutable commit SHA for ref." }, { status: 400 });

  try {
    const { git, docs } = await storesFor(brand);

    // Resolve HEAD to a concrete commit so the current version is cacheable
    // too - it stops being "current" the moment someone commits.
    const commitSha = ref || await git.head();

    const store = pdfStore();
    const key = commitSha ? cacheKey({ brand, slug, commitSha }) : null;
    const doc = await docs.readAt(brand, slug, commitSha);

    if (key) {
      const cached = await store.get(key);
      if (cached) {
        return pdfResponse(cached, { slug, ref, cached: true, renderMs: null });
      }
    }


    // Assets (assets/ and figures/) live beside the document; the renderer
    // needs them inlined.  figures/ holds external SVG files referenced by
    // ::figure{src="figures/chart.svg"} primitives.
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

    const assets = await collectAssetsFromGit(git, dir, assetPaths, commitSha);
    const brandId = doc.frontmatter?.brand || brand;
    const { pdf, renderMs } = await renderMarkdown(doc.content, brandId, assets);

    if (key) {
      // Never let a cache write failure fail a render.
      await store.put(key, pdf).catch(() => {});
    }

    return pdfResponse(pdf, { slug, ref, cached: false, renderMs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`render failed: ${msg}`, {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

function pdfResponse(
  pdf: Buffer,
  opts: { slug: string; ref?: string; cached: boolean; renderMs: number | null }
) {
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${opts.slug}${opts.ref ? `-${opts.ref.slice(0, 7)}` : ""}.pdf"`,
      // Preview bytes can drift after cache eviction; do not promise browser immutability.
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Docgent-Render-Ms": String(opts.renderMs ?? ""),
      "X-Docgent-Cache": opts.cached ? "hit" : "miss",
      "X-Docgent-Cache-Driver": cacheDriver(),
    },
  });
}
