import { storesFor } from "@/lib/store";
import { loadVocabulary } from "@/lib/vocabulary";
import { authorizeRequest } from "@/lib/agent-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Status transitions — informational only; used by GET to report which
 * transitions are common, but no longer enforced as hard gates.
 *
 * Any authorised token may move a document to any valid status. The
 * transition table is kept as a reference so callers can surface sensible
 * defaults in UIs without needing to encode the graph themselves.
 */
const TRANSITIONS: Record<string, string[]> = {
  draft: ["review"],
  review: ["approved", "draft"],
  approved: ["released", "review"],
  released: ["superseded"],
  superseded: [],
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const { brand, slug } = await ctx.params;

  const authz = await authorizeRequest(req, brand);
  if (!authz.ok) return new Response("unauthorised", { status: 401 });

  let body: { to?: string; note?: string; baseSha?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") return Response.json({ error: "expected an object" }, { status: 400 });
  const to = body.to;
  if (typeof body.baseSha !== "string" || !/^[a-f0-9]{40}$/.test(body.baseSha)) return Response.json({ error: "version_required", hint: "Read the document and send its exact blob SHA as baseSha." }, { status: 428 });
  if (!to) return Response.json({ error: "'to' status is required" }, { status: 400 });

  const vocab = loadVocabulary();
  const allowedStatuses = vocab.frontmatter.enums.status || [];
  if (!allowedStatuses.includes(to)) {
    return Response.json(
      { error: `'${to}' is not a valid status. Allowed: ${allowedStatuses.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const { docs } = await storesFor(brand);
    const doc = await docs.readDocument(brand, slug);
    if (body.baseSha !== doc.sha) return Response.json({ error: "stale", hint: "Reload and inspect the changed document before reviewing." }, { status: 409 });
    const from = doc.frontmatter?.status || "draft";

    // Rewrite the status line in place, preserving everything else.
    const content = doc.content;
    const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---\n)/);
    if (!fmMatch) {
      return Response.json({ error: "document has no frontmatter" }, { status: 422 });
    }
    const [, open, fmBody, close] = fmMatch;
    const hasStatus = /^status:\s*.*$/m.test(fmBody);
    const newFm = hasStatus
      ? fmBody.replace(/^status:\s*.*$/m, `status: ${to}`)
      : `${fmBody}\nstatus: ${to}`;
    const newContent = open + newFm + close + content.slice(fmMatch[0].length);

    // Legacy lifecycle transition only; durable PDF release is deferred.

    const who = authz.author.name;
    const email = authz.author.email;

    // Commit trailers keep the audit trail inside git itself.
    const trailers = [
      `Reviewed-Blob: ${body.baseSha}`,
      `Status-From: ${from}`,
      `Status-To: ${to}`,
      `Approved-By: ${who} <${email}>`,
      `Approved-At: ${new Date().toISOString()}`,
    ];
    if (body.note) trailers.splice(2, 0, `Note: ${body.note.replace(/\n/g, " ")}`);

    const message =
      `docs(${brand}/${slug}): ${from} → ${to}\n\n` +
      (body.note ? `${body.note}\n\n` : "") +
      trailers.join("\n");

    const result = await docs.saveDocument(brand, slug, newContent, {
      baseSha: body.baseSha,
      author: { name: who, email },
      message,
    });

    return Response.json({
      from,
      to,
      changed: result.changed,
      sha: result.sha,
      commit: result.commit,
    });
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err.name === "StaleWriteError") {
      return Response.json({ error: "stale", message: err.message }, { status: 409 });
    }
    return Response.json({ error: err.message || String(e) }, { status: 500 });
  }
}

/** Reports the current status and which transitions are available. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const { brand, slug } = await ctx.params;

  const authz = await authorizeRequest(req, brand);
  if (!authz.ok) return new Response("unauthorised", { status: 401 });

  try {
    const { docs } = await storesFor(brand);
    const doc = await docs.readDocument(brand, slug);
    const from = doc.frontmatter?.status || "draft";
    return Response.json({ status: from, allowed: TRANSITIONS[from] ?? [] });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
