import { auth } from "@/auth";
import { storesFor, agentTokenValidForBrand } from "@/lib/store";
import { loadVocabulary } from "@/lib/vocabulary";
import { validateMarkdown } from "@/lib/validate-client";
import { authorizeRequest } from "@/lib/agent-auth";
import { NotFoundError } from "../../../../../../../../packages/git-store/src/index.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reads a document (current HEAD or a specific commit).
 * Returns the blob SHA so the editor can send it back on save — that SHA is
 * what makes optimistic concurrency work.
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
    const { docs } = await storesFor(brand);
    const doc = ref
      ? await docs.readAt(brand, slug, ref)
      : await docs.readDocument(brand, slug);
    return Response.json({
      brand,
      slug,
      content: doc.content,
      sha: doc.sha ?? null,
      frontmatter: doc.frontmatter,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 404 });
  }
}

/**
 * Saves an edit.
 *
 * Two guards, in order:
 *   1. Registry validation — a document that fails the vocabulary contract is
 *      never committed. The build would reject it anyway; better to refuse
 *      here than to leave an unrenderable commit in the timeline.
 *   2. Optimistic concurrency — baseSha must match, or we return 409 with
 *      enough detail for the client to explain what happened.
 *
 * The commit is attributed to the signed-in user, not to a service account.
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const { brand, slug } = await ctx.params;

  const authz = await authorizeRequest(req, brand);
  if (!authz.ok) return new Response("unauthorised", { status: 401 });

  let body: { content?: string; baseSha?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const { content, baseSha, message } = body;
  if (typeof content !== "string" || !content.trim()) {
    return Response.json({ error: "'content' is required" }, { status: 400 });
  }

  // Guard 1: registry validation.
  try {
    const vocab = loadVocabulary();
    const diagnostics = validateMarkdown(content, vocab);
    const errors = diagnostics.filter((d) => d.severity === "error");
    if (errors.length) {
      return Response.json(
        {
          error: "validation failed",
          diagnostics: errors,
          hint: "Fix the errors, or add the missing term to the vocabulary registry.",
        },
        { status: 422 }
      );
    }
  } catch (e) {
    // A registry we cannot read is a deploy problem, not an author problem.
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `vocabulary registry unavailable: ${msg}` }, { status: 500 });
  }

  // Guard 2: optimistic concurrency, plus attribution.
  try {
    const { docs } = await storesFor(brand);
    const author = authz.author;

    const result = await docs.saveDocument(brand, slug, content, {
      baseSha,
      author,
      message,
    });

    return Response.json({
      changed: result.changed,
      sha: result.sha,
      commit: result.commit,
    });
  } catch (e) {
    const err = e as { name?: string; status?: number; message?: string; expected?: string; actual?: string };
    if (err.name === "StaleWriteError") {
      return Response.json(
        {
          error: "stale",
          message: err.message,
          expected: err.expected,
          actual: err.actual,
        },
        { status: 409 }
      );
    }
    return Response.json({ error: err.message || String(e) }, { status: 500 });
  }
}

/**
 * Deletes a document.
 *
 * Commits a deletion to the brand's documents repo via the GitHub API and
 * returns the commit reference so callers can verify the change. Returns 404
 * when the slug does not exist — callers should treat this as idempotent
 * rather than retrying, since a missing document is the desired end state.
 *
 * No body is required. Auth is the same bearer-token / session check every
 * other route on this path uses, so no extra credential is needed.
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const { brand, slug } = await ctx.params;

  const authz = await authorizeRequest(req, brand);
  if (!authz.ok) return new Response("unauthorised", { status: 401 });

  try {
    const { docs } = await storesFor(brand);
    const result = await docs.deleteDocument(brand, slug, {
      author: authz.author,
      message: `docs(${brand}/${slug}): delete via agent API`,
    });
    return Response.json({ deleted: result.deleted, slug, commit: result.commit });
  } catch (e) {
    if (e instanceof NotFoundError || (e as { name?: string }).name === "NotFoundError") {
      return Response.json({ error: `document not found: ${brand}/${slug}` }, { status: 404 });
    }
    return Response.json({ error: (e as Error).message || String(e) }, { status: 500 });
  }
}
