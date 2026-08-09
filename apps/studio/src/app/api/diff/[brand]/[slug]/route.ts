import { auth } from "@/auth";
import { storesFor } from "@/lib/store";
import { diffDocuments, diffHeadline } from "@/lib/diff";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Semantic diff between two commits of one document.
 *
 * Returns document-level changes ("keyfigure value 4.2M -> 4.8M") rather than
 * markdown line noise, because that is what a reviewer signing off on a
 * document actually needs to see.
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

    return Response.json({
      base,
      head: head || "HEAD",
      summary: diff.summary,
      headline: diffHeadline(diff),
      changes: diff.changes,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 404 });
  }
}
