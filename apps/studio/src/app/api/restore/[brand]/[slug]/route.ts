import { auth } from "@/auth";
import { storesFor } from "@/lib/store";
import { loadVocabulary } from "@/lib/vocabulary";
import { validateMarkdown } from "@/lib/validate-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Restores a document to the content of an earlier commit.
 *
 * This is a forward revert: the old content is written as a *new* commit on
 * top of HEAD, so nothing in the timeline is rewritten and the audit trail
 * stays intact. Restoring v6 over v7 produces a v8 whose content matches v6.
 *
 * Frontmatter status is deliberately carried over from HEAD rather than the
 * restored revision. Restoring content is an editorial act, not an approval
 * one - reinstating an old body should not silently drag a stale 'approved'
 * back with it, or demote a released document to whatever it was at v6.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const session = await auth();
  if (!session?.user) return new Response("unauthorised", { status: 401 });

  const { brand, slug } = await ctx.params;

  let body: { ref?: string; baseSha?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const ref = body.ref;
  if (!ref) return Response.json({ error: "'ref' is required" }, { status: 400 });

  try {
    const { docs } = storesFor(brand);

    const [source, head] = await Promise.all([
      docs.readAt(brand, slug, ref),
      docs.readDocument(brand, slug),
    ]);

    // Carry HEAD's status forward into the restored content.
    let content: string = source.content;
    const headStatus = head.frontmatter?.status;
    if (headStatus) {
      const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---\n)/);
      if (fmMatch) {
        const [, open, fmBody, close] = fmMatch;
        const newFm = /^status:\s*.*$/m.test(fmBody)
          ? fmBody.replace(/^status:\s*.*$/m, `status: ${headStatus}`)
          : `${fmBody}\nstatus: ${headStatus}`;
        content = open + newFm + close + content.slice(fmMatch[0].length);
      }
    }

    if (content === head.content) {
      return Response.json(
        {
          error: "no-op",
          message: "That revision is already the current content.",
        },
        { status: 409 }
      );
    }

    // Same contract as an ordinary save: an invalid document never lands,
    // even when the invalid content came from our own history.
    const vocab = loadVocabulary();
    const errors = validateMarkdown(content, vocab).filter((d) => d.severity === "error");
    if (errors.length) {
      return Response.json(
        {
          error: "validation failed",
          diagnostics: errors,
          hint: "This revision predates the current vocabulary registry. Restore it in the editor and fix the errors before saving.",
        },
        { status: 422 }
      );
    }

    const who = session.user.name || (session.user as { login?: string }).login || "DocForge Studio";
    const email = session.user.email || "studio@docforge.local";
    const short = ref.slice(0, 7);

    const trailers = [
      `Restored-From: ${ref}`,
      `Restored-By: ${who} <${email}>`,
      `Restored-At: ${new Date().toISOString()}`,
    ];

    const message =
      `docs(${brand}/${slug}): restore ${short}\n\n` +
      (body.note ? `${body.note}\n\n` : "") +
      trailers.join("\n");

    const result = await docs.saveDocument(brand, slug, content, {
      baseSha: body.baseSha || head.sha,
      author: { name: who, email },
      message,
    });

    return Response.json({
      restoredFrom: ref,
      changed: result.changed,
      sha: result.sha,
      commit: result.commit,
    });
  } catch (e) {
    const err = e as { name?: string; message?: string; expected?: string; actual?: string };
    if (err.name === "StaleWriteError") {
      return Response.json(
        {
          error: "stale",
          message: "The document changed while you were viewing it. Reload and try again.",
          expected: err.expected,
          actual: err.actual,
        },
        { status: 409 }
      );
    }
    return Response.json({ error: err.message || String(e) }, { status: 500 });
  }
}
