import { auth } from "@/auth";
import { storesFor } from "@/lib/store";
import { loadVocabulary } from "@/lib/vocabulary";
import { validateMarkdown } from "@/lib/validate-client";
import { findModel } from "@/lib/models";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Accepts a proposed rewrite.
 *
 * The proposal itself is not stored server-side. The client holds it and sends
 * back the full proposed source plus the SHA it was computed against; this
 * route validates and commits it. Keeping proposals out of the database means
 * there is no pending-state to expire, reconcile or garbage-collect, and a
 * proposal the author abandoned simply ceases to exist.
 *
 * What makes this safe is baseSha. If the document moved between proposing and
 * accepting — an agent committed from Slack, someone else saved in Studio —
 * the underlying store rejects the write rather than silently clobbering the
 * newer content.
 *
 * Every commit made here carries a trailer naming the model, the instruction
 * and the person who accepted it. A document that has been partly written by a
 * model should say so in its own history, not only in a UI that may not be
 * there in a year.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const session = await auth();
  if (!session?.user) return new Response("unauthorised", { status: 401 });

  const { brand, slug } = await ctx.params;

  let body: {
    content?: string;
    baseSha?: string;
    instruction?: string;
    model?: string;
    scopeLabel?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const { content, baseSha, instruction, model: modelId, scopeLabel } = body;

  if (typeof content !== "string" || !content.trim()) {
    return Response.json({ error: "'content' is required" }, { status: 400 });
  }
  if (!instruction || !instruction.trim()) {
    return Response.json({ error: "'instruction' is required" }, { status: 400 });
  }

  const model = modelId ? findModel(modelId) : null;
  if (modelId && !model) {
    return Response.json({ error: `Unknown model '${modelId}'` }, { status: 400 });
  }

  // Validate before committing. The rewrite route already checked this when it
  // produced the proposal, but a client may have edited the text afterwards and
  // the commit is the boundary that actually matters.
  try {
    const vocab = loadVocabulary();
    const errors = validateMarkdown(content, vocab).filter(
      (d) => d.severity === "error"
    );
    if (errors.length) {
      return Response.json(
        {
          error: "validation failed",
          diagnostics: errors,
          hint: "The rewrite broke the vocabulary contract. Reject it, or fix the text before accepting.",
        },
        { status: 422 }
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: `vocabulary registry unavailable: ${msg}` },
      { status: 500 }
    );
  }

  const who = session.user.email || session.user.name || "unknown";

  try {
    const { docs } = storesFor(brand);
    const author = {
      name:
        session.user.name ||
        (session.user as { login?: string }).login ||
        "DocForge Studio",
      email: session.user.email || "studio@docforge.local",
    };

    const result = await docs.saveDocument(brand, slug, content, {
      baseSha,
      author,
      message: commitMessage({
        instruction,
        scopeLabel,
        modelLabel: model?.label,
        modelId: model?.id,
        who,
      }),
    });

    return Response.json({
      changed: result.changed,
      sha: result.sha,
      commit: result.commit,
    });
  } catch (e) {
    const err = e as {
      name?: string;
      message?: string;
      expected?: string;
      actual?: string;
    };
    if (err.name === "StaleWriteError") {
      return Response.json(
        {
          error: "stale",
          message:
            "The document changed while this rewrite was open. Re-run it against the current text.",
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
 * Subject line reads as an editorial act, not as machinery: "Rewrite
 * Introduction: lead with the revenue argument". The trailers below carry the
 * provenance a reader needs to audit it.
 *
 * The subject is truncated because git subjects wrap badly past ~72 chars; the
 * untruncated instruction survives in the body, so nothing is actually lost.
 */
function commitMessage(opts: {
  instruction: string;
  scopeLabel?: string;
  modelLabel?: string;
  modelId?: string;
  who: string;
}): string {
  const { instruction, scopeLabel, modelLabel, modelId, who } = opts;
  const flat = instruction.replace(/\s+/g, " ").trim();
  const where = scopeLabel ? ` ${scopeLabel}` : "";
  const subject = truncate(`Rewrite${where}: ${flat}`, 72);

  const lines = [subject, ""];
  lines.push(`Instruction: ${flat}`);
  if (modelLabel) lines.push(`Model: ${modelLabel}${modelId ? ` (${modelId})` : ""}`);
  if (scopeLabel) lines.push(`Scope: ${scopeLabel}`);
  lines.push(`Accepted-by: ${who}`);
  lines.push("Generated-by: DocForge Studio");
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}
