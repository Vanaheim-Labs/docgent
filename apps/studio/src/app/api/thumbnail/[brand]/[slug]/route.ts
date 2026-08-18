import { storesFor } from "@/lib/store";
import { renderThumbnail, collectAssetsFromGit } from "@/lib/render";
import { pdfStore, thumbCacheKey, cacheDriver } from "@/lib/pdf-cache";
import { authorizeRequest } from "@/lib/agent-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Serves a page-1 PNG thumbnail for a historical revision, for the version
 * filmstrip in VersionPanel.
 *
 * Same content-addressing as /api/render: keyed by commit SHA, immutable
 * once cached, because a thumbnail must represent what that commit actually
 * printed — not a re-render under today's design system.
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
    const { git, docs } = await storesFor(brand);

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
    const key = commitSha ? thumbCacheKey({ brand, slug, commitSha }) : null;

    if (key) {
      const cached = await store.get(key);
      if (cached) {
        return pngResponse(cached, { ref, cached: true });
      }
    }

    const doc = ref
      ? await docs.readAt(brand, slug, ref)
      : await docs.readDocument(brand, slug);

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
    const { png } = await renderThumbnail(doc.content, brandId, assets);

    if (key) {
      await store.put(key, png).catch(() => {});
    }

    return pngResponse(png, { ref, cached: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`thumbnail failed: ${msg}`, {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

function pngResponse(png: Buffer, opts: { ref?: string; cached: boolean }) {
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": opts.ref
        ? "private, max-age=31536000, immutable"
        : "private, max-age=0, must-revalidate",
      "X-Docgent-Cache": opts.cached ? "hit" : "miss",
      "X-Docgent-Cache-Driver": cacheDriver(),
    },
  });
}
