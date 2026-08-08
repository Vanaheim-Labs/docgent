import { auth } from "@/auth";
import { stores } from "@/lib/store";
import { renderMarkdown, collectAssetsFromGit } from "@/lib/render";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Renders a document to PDF via the Phase 2 worker.
 *
 * ?ref=<commitSha> renders a historical version, which is what makes the
 * version timeline clickable. Without a ref we render current HEAD.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const session = await auth();
  if (!session) {
    return new Response("unauthorised", { status: 401 });
  }

  const { brand, slug } = await ctx.params;
  const ref = new URL(req.url).searchParams.get("ref") || undefined;

  try {
    const { git, docs } = stores();

    const doc = ref
      ? await docs.readAt(brand, slug, ref)
      : await docs.readDocument(brand, slug);

    // Assets live beside the document; the renderer needs them inlined.
    const dir = `documents/${brand}/${slug}`;
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

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${slug}${ref ? `-${ref.slice(0, 7)}` : ""}.pdf"`,
        // Historical versions are immutable, so cache them hard.
        "Cache-Control": ref
          ? "private, max-age=31536000, immutable"
          : "private, max-age=0, must-revalidate",
        "X-DocForge-Render-Ms": String(renderMs ?? ""),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`render failed: ${msg}`, {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
