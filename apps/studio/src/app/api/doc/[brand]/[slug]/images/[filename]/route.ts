import { authorizeRequest } from "@/lib/agent-auth";
import { storesFor, agentAuthorForBrand } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Document image upload for agent tokens and Studio.
 *
 * PUT  /api/doc/<brand>/<slug>/images/<filename>
 *
 *   Uploads or replaces a raster image (PNG/JPG/etc.) in the document's
 *   images/ directory in the brand's documents git repo. Images stored here
 *   are referenced in the document source with:
 *
 *     ::image{src="images/<filename>" caption="..." width="column"}
 *
 *   The render pipeline collects images/ alongside assets/ and figures/,
 *   writing them to the pandoc working directory before rendering.
 *
 *   Two content modes:
 *
 *   a) JSON body: { content: "<base64>", encoding: "base64", message?: string }
 *      For programmatic uploads.
 *
 *   b) Raw body: any Content-Type other than application/json is treated as
 *      binary data and base64-encoded before committing. This lets an agent
 *      pipe a PNG directly rather than building a JSON wrapper.
 *
 *   The filename must be safe (no path traversal — only [a-zA-Z0-9._-]).
 *   The commit is attributed to the brand's agent identity or the signed-in user.
 *
 * Authentication: brand-scoped bearer token or active Studio session.
 */

const SAFE_FILENAME = /^[a-zA-Z0-9._-]+$/;

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string; filename: string }> }
) {
  const { brand, slug, filename } = await ctx.params;

  // Filename safety — no path traversal.
  if (!SAFE_FILENAME.test(filename)) {
    return Response.json(
      { error: `unsafe filename: '${filename}' — only letters, digits, dots, hyphens and underscores are allowed` },
      { status: 400 }
    );
  }

  const authz = await authorizeRequest(req, brand);
  if (!authz.ok) return new Response("unauthorised", { status: 401 });

  const contentType = req.headers.get("content-type") || "";
  let content: string;
  let encoding: "utf-8" | "base64";
  let message: string | undefined;

  if (contentType.includes("application/json")) {
    // Structured upload.
    let body: { content?: string; encoding?: string; message?: string };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "expected a JSON body" }, { status: 400 });
    }
    if (typeof body.content !== "string") {
      return Response.json({ error: "'content' is required" }, { status: 400 });
    }
    encoding = body.encoding === "base64" ? "base64" : "utf-8";
    content = body.content;
    message = typeof body.message === "string" ? body.message : undefined;
  } else {
    // Raw binary upload — base64-encode for git storage.
    const buf = await req.arrayBuffer();
    content = Buffer.from(buf).toString("base64");
    encoding = "base64";
  }

  const author =
    authz.via === "agent-token" ? agentAuthorForBrand(brand) : authz.author;

  const imagePath = `documents/${slug}/images/${filename}`;
  const commitMessage =
    message ?? `docs(${brand}/${slug}): upload image ${filename} via agent`;

  try {
    const { git } = await storesFor(brand);

    // Read current sha if the file exists, so we can supply it for a clean update.
    let currentSha: string | undefined;
    try {
      const existing = await (git as any).readFile(imagePath);
      currentSha = existing.sha;
    } catch {
      // File doesn't exist yet — create is sha-free.
    }

    // Decode content to bytes, then write via commitFiles for consistency with
    // other document asset writes (supports both base64 and utf-8 bodies).
    const contentBytes =
      encoding === "base64"
        ? content
        : Buffer.from(content, "utf-8").toString("base64");

    const result = await (git as any).writeFile(imagePath, contentBytes, {
      message: commitMessage,
      encoding: "base64",
      ...(currentSha ? { sha: currentSha } : {}),
      author: { name: author.name, email: author.email, date: new Date().toISOString() },
    });

    return Response.json({
      changed: result.changed,
      sha: result.sha,
      commit: result.commit,
      path: `documents/${slug}/images/${filename}`,
    });
  } catch (e) {
    const err = e as { name?: string; status?: number; message?: string };
    return Response.json({ error: err.message || String(e) }, { status: 500 });
  }
}
