import { auth } from "@/auth";
import { storesFor } from "@/lib/store";
import { diffDocuments, diffHeadline, diffUnified } from "@/lib/diff";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Diff between two commits of one document.
 *
 * Returns both views. The semantic summary ("keyfigure value 4.2M -> 4.8M")
 * tells a reviewer what changed in document terms; the unified line diff shows
 * the text itself with line numbers and context, the way a pull request does.
 * One request serves both because they come from the same pair of blobs and a
 * second round trip to switch tabs would be pure latency.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const session = await auth();
  if (!session) return new Response("unauthorised", { status: 401 });

  const { brand, slug } = await ctx.params;
  const url = new URL(req.url);
  const base = url.searchParams.get("base");
  const head = url.searchParams.get("head");

  // Context lines either side of a hunk. Clamped: 0 is legitimate (changes
  // only) and anything past a few dozen is the whole document, which the
  // "expand all" affordance already covers.
  const rawContext = Number(url.searchParams.get("context"));
  const context = Number.isFinite(rawContext)
    ? Math.min(Math.max(Math.trunc(rawContext), 0), 50)
    : 3;

  if (!base) {
    return Response.json({ error: "'base' commit is required" }, { status: 400 });
  }

  try {
    const { docs } = storesFor(brand);

    const [beforeDoc, afterDoc] = await Promise.all([
      docs.readAt(brand, slug, base),
      head ? docs.readAt(brand, slug, head) : docs.readDocument(brand, slug),
    ]);

    const diff = diffDocuments(beforeDoc.content, afterDoc.content);
    const unified = diffUnified(beforeDoc.content, afterDoc.content, context);

    return Response.json({
      base,
      head: head || "HEAD",
      summary: diff.summary,
      headline: diffHeadline(diff),
      changes: diff.changes,
      unified,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 404 });
  }
}
