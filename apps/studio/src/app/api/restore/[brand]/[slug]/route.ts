import { auth } from "@/auth";
import { storesFor } from "@/lib/store";
import { loadVocabulary } from "@/lib/vocabulary";
import { validateMarkdown } from "@/lib/validate-client";
// Untyped ESM package in the monorepo; allowJs resolves it without types.
import { nextVersion, setFrontmatterVersion } from "../../../../../../../../packages/core/src/version.mjs";

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
 *
 * The frontmatter version is bumped rather than restored, for the same class
 * of reason. Copying an old blob forward verbatim copies its old version with
 * it, so the newest commit ends up carrying a lower version than an earlier
 * one - which is exactly how this document reached a state where v13 preceded
 * v12. Readers and agents resolve "the current version" by taking the highest
 * number, so that number has to keep rising.
 *
 * The bump is past the high-water mark across all history, not past HEAD. A
 * document that reached 14.0 and was restored to 12.0 must go to 15.0, never
 * back to 13.0: that number was already spent on different content, and
 * reissuing it would make a cited version ambiguous. Gaps are the price of
 * never reusing a number, and are harmless.
 *
 * Consequence worth knowing: a restore can no longer produce a byte-identical
 * file, since the frontmatter always differs. The no-op check below therefore
 * compares bodies with the version line normalised away, so restoring content
 * that is already current is still correctly rejected.
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

    const [source, head, timeline] = await Promise.all([
      docs.readAt(brand, slug, ref),
      docs.readDocument(brand, slug),
      // Every issued version, so the bump clears the high-water mark rather
      // than HEAD. Failure here must not block the restore: falling back to
      // HEAD's version alone still yields a rising number, just a less
      // well-informed one.
      docs.timeline(brand, slug, { limit: 100 }).catch(() => []),
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

    // Reject a restore that would change nothing. Compared before the version
    // bump and with the version line normalised away, since the bump would
    // otherwise make every restore look like a real change.
    const stripVersion = (s: string) => setFrontmatterVersion(s, "0");
    if (stripVersion(content) === stripVersion(head.content)) {
      return Response.json(
        {
          error: "no-op",
          message: "That revision is already the current content.",
        },
        { status: 409 }
      );
    }

    // Bump past every version this document has ever carried.
    const issued: string[] = await Promise.all(
      (timeline as { sha: string }[]).map(async (t) => {
        try {
          const at = await docs.readAt(brand, slug, t.sha);
          return at.frontmatter?.version ?? null;
        } catch {
          return null;
        }
      })
    ).then((vs) => vs.filter((v): v is string => Boolean(v)));

    // HEAD and the restored revision are included even if the timeline read
    // failed, so the result still clears both known versions.
    const bumped = nextVersion([
      ...issued,
      head.frontmatter?.version,
      source.frontmatter?.version,
    ]);
    const restoredVersion = source.frontmatter?.version ?? null;
    content = setFrontmatterVersion(content, bumped);

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
      // The version the restored content originally carried. Provenance lives
      // here rather than in the frontmatter, so 'version:' keeps meaning
      // "which issue is this" rather than doubling as lineage.
      ...(restoredVersion ? [`Restored-Version: ${restoredVersion}`] : []),
      `Restored-By: ${who} <${email}>`,
      `Restored-At: ${new Date().toISOString()}`,
    ];

    const message =
      `docs(${brand}/${slug}): restore ${short} as v${bumped}\n\n` +
      (body.note ? `${body.note}\n\n` : "") +
      trailers.join("\n");

    const result = await docs.saveDocument(brand, slug, content, {
      baseSha: body.baseSha || head.sha,
      author: { name: who, email },
      message,
    });

    return Response.json({
      restoredFrom: ref,
      restoredVersion,
      version: bumped,
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
