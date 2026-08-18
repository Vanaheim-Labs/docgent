import { authorizeRequest } from "@/lib/agent-auth";
import { findBrand } from "@/lib/store";
import { writeBrandAssetToGit, agentAuthorForBrand } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Brand asset upload for agent tokens.
 *
 * PUT  /api/brand/<brand>/assets/<filename>
 *
 *   Uploads or replaces a file in the brand's assets/ directory in the
 *   docgent-brands git repo. Two content modes:
 *
 *   a) JSON body: { content: "<base64 or utf-8 text>", encoding: "base64" | "utf-8", message?: string }
 *      For programmatic uploads (SVG logos, CSS overrides, etc.).
 *
 *   b) Raw body: any Content-Type other than application/json is treated as
 *      binary data and base64-encoded before committing. This lets an agent
 *      pipe a PNG directly rather than building a JSON wrapper.
 *
 *   The filename must be safe (no path traversal — only [a-zA-Z0-9._-]).
 *   The commit is attributed to the brand's agent identity.
 *
 * Authentication: brand-scoped bearer token or active Studio session.
 */

const SAFE_FILENAME = /^[a-zA-Z0-9._-]+$/;

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ brand: string; filename: string }> }
) {
  const { brand, filename } = await ctx.params;

  // Filename safety — no path traversal.
  if (!SAFE_FILENAME.test(filename)) {
    return Response.json(
      { error: `unsafe filename: '${filename}' — only letters, digits, dots, hyphens and underscores are allowed` },
      { status: 400 }
    );
  }

  const authz = await authorizeRequest(req, brand);
  if (!authz.ok) return new Response("unauthorised", { status: 401 });

  const brandRecord = findBrand(brand);
  if (!brandRecord) {
    return Response.json({ error: `unknown brand: ${brand}` }, { status: 404 });
  }

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

  try {
    const result = await writeBrandAssetToGit(brand, filename, content, encoding, author, message);
    return Response.json({
      changed: result.changed,
      sha: result.sha,
      commit: result.commit,
      path: `${brand}/assets/${filename}`,
    });
  } catch (e) {
    const err = e as { name?: string; status?: number; message?: string };
    return Response.json({ error: err.message || String(e) }, { status: 500 });
  }
}
