import { storesFor } from "@/lib/store";
import { renderMarkdownHtml, collectAssetsFromGit } from "@/lib/render";
import { authorizeRequest } from "@/lib/agent-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Renders UNSAVED editor content to HTML for the live preview pane.
 *
 * Mirrors the PDF preview route, but returns the pandoc HTML with
 * data-source-line anchors so the editor can align its two panes. The PDF
 * route remains the fidelity path.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const { brand, slug } = await ctx.params;

  const authz = await authorizeRequest(req, brand);
  if (!authz.ok) return new Response("unauthorised", { status: 401 });

  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("expected a JSON body", { status: 400 });
  }

  const content = body.content;
  if (typeof content !== "string" || !content.trim()) {
    return new Response("'content' is required", { status: 400 });
  }

  try {
    const { git } = storesFor(brand);
    const dir = `documents/${slug}`;

    let assetPaths: string[] = [];
    try {
      const tree = await git.tree({ prefix: `${dir}/assets/` });
      assetPaths = tree.entries
        .filter((e: { type: string }) => e.type === "file")
        .map((e: { path: string }) => e.path.slice(dir.length + 1));
    } catch {
      // no assets is fine
    }

    const assets = await collectAssetsFromGit(git, dir, assetPaths);

    const fmBrand = content.match(/^---\n[\s\S]*?\bbrand:\s*(\S+)/)?.[1];
    const { html, renderMs } = await renderMarkdownHtml(
      content,
      fmBrand || brand,
      assets
    );

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Docgent-Render-Ms": String(renderMs ?? ""),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`preview failed: ${msg}`, {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
