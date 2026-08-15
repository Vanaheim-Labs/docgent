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
 * Historical renders are content-addressed and cached by commit SHA. That is
 * not merely an optimisation: a rendered version must be *retrievable*, not
 * *regenerable*. If the design system changes, re-rendering an old commit
 * produces a different artefact - which is the wrong answer to "what exactly
 * did we send the client in March?".
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const { brand, slug } = await ctx.params;

  const authz = await authorizeRequest(req, brand);
  if (!authz.ok) return new Response("unauthorised", { status: 401 });

  const ref = new URL(req.url).searchParams.get("ref") || undefined;

  try {
    const { git, docs } = storesFor(brand);

    // Resolve HEAD to a concrete commit so the current version is cacheable
    // too - it stops being "current" the moment someone commits.
    let commitSha = ref;
    if (!commitSha) {
      try {
        const tl = await docs.timeline(brand, slug, { limit: 1 });
        commitSha = tl[0]?.sha;
      } catch {
        // history unavailable; fall through to an uncached render
      }
    }

    const store = pdfStore();
    const key = commitSha ? cacheKey({ brand, slug, commitSha }) : null;

    if (key) {
      const cached = await store.get(key);
      if (cached) {
        return pdfResponse(cached, { slug, ref, cached: true, renderMs: null });
      }
    }

    const doc = ref
      ? await docs.readAt(brand, slug, ref)
      : await docs.readDocument(brand, slug);

    // Assets live beside the document; the renderer needs them inlined.
    const dir = `documents/${slug}`;
    let assetPaths: string[] = [];
    try {
      const tree = await git.tree({ ref, prefix: `${dir}/assets/` });
      assetPaths = tree.entries
        .filter((e: { type: string; path: string }) => e.type === "file")
        .map((e: { path: string }) => e.path.slice(dir.length + 1));
    } catch {
      // no assets directory is fine
    }

    const assets = await collectAssetsFromGit(git, dir, assetPaths, ref);
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
      // Historical versions are immutable, so cache them hard.
      "Cache-Control": opts.ref
        ? "private, max-age=31536000, immutable"
        : "private, max-age=0, must-revalidate",
      "X-Docgent-Render-Ms": String(opts.renderMs ?? ""),
      "X-Docgent-Cache": opts.cached ? "hit" : "miss",
      "X-Docgent-Cache-Driver": cacheDriver(),
    },
  });
}
