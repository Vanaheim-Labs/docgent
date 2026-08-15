import { storesFor, findBrand } from "@/lib/store";
import { authorizeRequest } from "@/lib/agent-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lists every document in one brand's store.
 *
 * This is the discovery endpoint the docgent-doc-access skill previously
 * had to say didn't exist — an agent working purely through the API had no
 * way to answer "what documents does inkl have" without a human supplying
 * exact slugs. It reuses the same DocumentStore.listDocuments() call that
 * already backs the Studio index page, so this list can never drift from
 * what a human sees in Studio.
 *
 * Deliberately metadata-only (no `content`) — an agent asking "what's
 * available" wants slugs, titles, doctypes and status, not every document's
 * full body in one response. Read /api/doc/<brand>/<slug> for content.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ brand: string }> }
) {
  const { brand } = await ctx.params;

  const authz = await authorizeRequest(req, brand);
  if (!authz.ok) return new Response("unauthorised", { status: 401 });

  if (!findBrand(brand)) {
    return Response.json({ error: `Unknown brand '${brand}'` }, { status: 404 });
  }

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status") || undefined;
  const doctypeFilter = url.searchParams.get("doctype") || undefined;

  try {
    const { docs } = storesFor(brand);
    const { documents } = await docs.listDocuments({ brand, withFrontmatter: true });

    let out = documents.map((d: (typeof documents)[number]) => {
      const fm = d.frontmatter || {};
      return {
        slug: d.slug,
        title: (fm.title && String(fm.title).trim()) || d.slug,
        doctype: fm.doctype ?? null,
        status: fm.status ?? null,
        classification: fm.classification ?? null,
        version: fm.version ?? null,
        date: fm.date ?? null,
        sha: d.blobSha ?? d.sha ?? null,
      };
    });

    if (statusFilter) out = out.filter((d: { status: string | null }) => d.status === statusFilter);
    if (doctypeFilter) out = out.filter((d: { doctype: string | null }) => d.doctype === doctypeFilter);

    return Response.json({ brand, count: out.length, documents: out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
