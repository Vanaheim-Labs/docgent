import { auth } from "@/auth";
import { storesFor } from "@/lib/store";
import { loadVocabulary } from "@/lib/vocabulary";
import { validateMarkdown } from "@/lib/validate-client";
import {
  availableModels,
  complete,
  DEFAULT_MODEL,
  findModel,
  ModelError,
} from "@/lib/models";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * A directed rewrite.
 *
 * The human names a scope and says what they want changed; a model rewrites
 * that span; the result comes back as a *proposal*, not a commit. Nothing here
 * writes to the repository.
 *
 * That staging is the point. The same endpoint serves Studio (a person selects
 * text and types an instruction) and Slack (an agent proposes a change on a
 * document nobody currently has open). If accepting were folded into this call,
 * the Slack path would commit unreviewed prose and the two front doors would
 * stop sharing a history.
 *
 * Scope is one of:
 *   - section:  a heading and everything under it, addressed by heading text
 *   - range:    an explicit character span, for a selection in the editor
 *   - document: the whole source
 */

/** The models the picker may offer, so the client never names a key. */
export async function GET() {
  const session = await auth();
  if (!session) return new Response("unauthorised", { status: 401 });
  const models = availableModels();
  return Response.json({
    models: models.map((m) => ({ id: m.id, label: m.label, provider: m.provider })),
    default: models.some((m) => m.id === DEFAULT_MODEL)
      ? DEFAULT_MODEL
      : models[0]?.id ?? null,
  });
}

type Scope =
  | { kind: "document" }
  | { kind: "section"; heading: string }
  | { kind: "range"; start: number; end: number };

type Body = {
  instruction?: string;
  model?: string;
  scope?: Scope;
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const session = await auth();
  if (!session?.user) return new Response("unauthorised", { status: 401 });

  const { brand, slug } = await ctx.params;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const instruction = (body.instruction || "").trim();
  if (!instruction) {
    return Response.json({ error: "'instruction' is required" }, { status: 400 });
  }

  const model = findModel(body.model || DEFAULT_MODEL);
  if (!model) {
    return Response.json({ error: `Unknown model '${body.model}'` }, { status: 400 });
  }

  const scope: Scope = body.scope || { kind: "document" };

  // Read HEAD. The proposal is pinned to the SHA it was computed against, so
  // accepting it later can detect that the document moved underneath it.
  let source: string;
  let baseSha: string | null;
  try {
    const { docs } = storesFor(brand);
    const doc = await docs.readDocument(brand, slug);
    source = doc.content;
    baseSha = doc.sha ?? null;
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 404 }
    );
  }

  let span: { start: number; end: number };
  try {
    span = resolveScope(source, scope);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 422 }
    );
  }

  const target = source.slice(span.start, span.end);
  if (!target.trim()) {
    return Response.json({ error: "That scope is empty." }, { status: 422 });
  }

  let rewritten: string;
  try {
    rewritten = await complete({
      model,
      system: SYSTEM,
      user: buildPrompt({ instruction, target, whole: source, scope }),
    });
  } catch (e) {
    if (e instanceof ModelError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  rewritten = stripFence(rewritten);

  const proposed =
    source.slice(0, span.start) + rewritten + source.slice(span.end);

  // Validate the *document*, not the fragment. A rewrite that breaks the
  // vocabulary contract is reported now, on a proposal the author can reject,
  // rather than at save time on prose they have already accepted.
  let diagnostics: { line: number; severity: string; message: string }[] = [];
  try {
    const vocab = loadVocabulary();
    diagnostics = validateMarkdown(proposed, vocab);
  } catch {
    // A registry we cannot read is a deploy problem. Do not block the proposal
    // on it; save still validates server-side before it commits.
  }
  const errors = diagnostics.filter((d) => d.severity === "error");

  return Response.json({
    brand,
    slug,
    baseSha,
    scope,
    instruction,
    model: { id: model.id, label: model.label, provider: model.provider },
    span,
    before: target,
    after: rewritten,
    /** Full source with the rewrite applied — what the editor diffs against. */
    proposed,
    diagnostics: errors,
    valid: errors.length === 0,
    /**
     * Provenance for the commit trailer, so an accepted rewrite stays
     * traceable to the prompt and the model that produced it.
     */
    attribution: {
      model: model.id,
      provider: model.provider,
      instruction,
      requestedBy: session.user.email || session.user.name || "unknown",
      at: new Date().toISOString(),
    },
  });
}

/**
 * Turns a scope into a character span.
 *
 * Headings are addressed by their text rather than an index because an agent
 * working from Slack knows the heading it was asked about, not its ordinal,
 * and ordinals shift the moment anyone reorders a section.
 */
function resolveScope(source: string, scope: Scope): { start: number; end: number } {
  if (scope.kind === "document") return { start: 0, end: source.length };

  if (scope.kind === "range") {
    const start = Math.max(0, Math.min(source.length, scope.start | 0));
    const end = Math.max(start, Math.min(source.length, scope.end | 0));
    return { start, end };
  }

  const wanted = scope.heading.trim().toLowerCase();
  if (!wanted) throw new Error("scope.heading is required");

  const re = /^(#{1,6})[ \t]+(.+?)[ \t]*$/gm;
  let m: RegExpExecArray | null;
  const headings: { level: number; text: string; start: number; bodyEnd: number }[] = [];
  while ((m = re.exec(source))) {
    headings.push({
      level: m[1].length,
      text: m[2].trim(),
      start: m.index,
      bodyEnd: source.length,
    });
  }
  // A section ends at the next heading of the same or shallower level.
  for (let i = 0; i < headings.length; i++) {
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= headings[i].level) {
        headings[i].bodyEnd = headings[j].start;
        break;
      }
    }
  }

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const hit =
    headings.find((h) => h.text.toLowerCase() === wanted) ??
    headings.find((h) => norm(h.text) === norm(wanted));

  if (!hit) {
    throw new Error(
      `No section titled '${scope.heading}'. Headings: ${headings
        .map((h) => h.text)
        .slice(0, 12)
        .join(" · ")}`
    );
  }
  return { start: hit.start, end: hit.bodyEnd };
}

const SYSTEM = [
  "You are editing a Markdown document under instruction.",
  "",
  "Rules:",
  "- Return ONLY the rewritten Markdown for the span you were given.",
  "- No preamble, no explanation, no code fences around the whole answer.",
  "- Preserve the heading level and structure unless told to change it.",
  "- Preserve any custom block directives (:::name ... :::) exactly unless the instruction is about them.",
  "- Do not invent facts, figures, names or citations that are not already present.",
  "- Do not touch YAML frontmatter unless explicitly instructed.",
  "- Match the surrounding voice and register.",
].join("\n");

function buildPrompt(opts: {
  instruction: string;
  target: string;
  whole: string;
  scope: Scope;
}): string {
  const { instruction, target, whole, scope } = opts;
  const parts: string[] = [];

  // Surrounding document as context, but only when the span is not the whole
  // thing — otherwise it is sent twice.
  if (scope.kind !== "document") {
    const trimmed =
      whole.length > 12000 ? whole.slice(0, 12000) + "\n\n[...truncated...]" : whole;
    parts.push("Full document, for context only:");
    parts.push("<document>");
    parts.push(trimmed);
    parts.push("</document>");
    parts.push("");
  }

  parts.push("Rewrite this span:");
  parts.push("<span>");
  parts.push(target);
  parts.push("</span>");
  parts.push("");
  parts.push("Instruction:");
  parts.push(instruction);
  parts.push("");
  parts.push("Return only the rewritten Markdown for that span.");
  return parts.join("\n");
}

/**
 * Models wrap answers in fences despite instruction. Strip one only when it
 * encloses the entire response, so fenced code *inside* a rewrite survives.
 */
function stripFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[a-zA-Z0-9-]*\n([\s\S]*?)\n```$/);
  return m ? m[1] : t;
}
