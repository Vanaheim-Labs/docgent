import { auth } from "@/auth";
import { stores } from "@/lib/store";
import { loadVocabulary } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Approval gates.
 *
 * Status lives in frontmatter, so a transition is an ordinary commit and the
 * approval is recorded in git history rather than in a side database. Sign-off
 * is captured as a commit trailer, which survives clone, mirror and export -
 * unlike a row in a table that only this app knows how to read.
 *
 * The lifecycle is deliberately linear with one escape hatch (supersede), so
 * "who approved this and when" always has a single answer.
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
  const session = await auth();
  if (!session?.user) return new Response("unauthorised", { status: 401 });

  const { brand, slug } = await ctx.params;

  let body: { to?: string; note?: string; baseSha?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const to = body.to;
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
    const { docs } = stores();
    const doc = await docs.readDocument(brand, slug);
    const from = doc.frontmatter?.status || "draft";

    const permitted = TRANSITIONS[from] ?? [];
    if (from !== to && !permitted.includes(to)) {
      return Response.json(
        {
          error: `Cannot move from '${from}' to '${to}'.`,
          from,
          allowed: permitted,
        },
        { status: 409 }
      );
    }

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

    const who = session.user.name || (session.user as { login?: string }).login || "unknown";
    const email = session.user.email || "studio@docforge.local";

    // Commit trailers keep the audit trail inside git itself.
    const trailers = [
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
      baseSha: body.baseSha || doc.sha,
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
  _req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const session = await auth();
  if (!session) return new Response("unauthorised", { status: 401 });

  const { brand, slug } = await ctx.params;
  try {
    const { docs } = stores();
    const doc = await docs.readDocument(brand, slug);
    const from = doc.frontmatter?.status || "draft";
    return Response.json({ status: from, allowed: TRANSITIONS[from] ?? [] });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
