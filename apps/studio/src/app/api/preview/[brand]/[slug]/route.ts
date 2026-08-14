import { auth } from "@/auth";
import { storesFor } from "@/lib/store";
import { renderMarkdown, collectAssetsFromGit } from "@/lib/render";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Renders UNSAVED editor content to PDF.
 *
 * The read path (/api/render) renders what is committed. This renders what the
 * author is currently typing, so preview reflects the buffer rather than the
 * last commit. Assets still come from git — the editor does not upload them.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const session = await auth();
  if (!session) return new Response("unauthorised", { status: 401 });

  const { brand, slug } = await ctx.params;

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

    // Brand comes from the buffer's frontmatter so switching brand mid-edit
    // previews correctly.
    const fmBrand = content.match(/^---\n[\s\S]*?\bbrand:\s*(\S+)/)?.[1];
    const { pdf, renderMs } = await renderMarkdown(content, fmBrand || brand, assets);

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${slug}-preview.pdf"`,
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
