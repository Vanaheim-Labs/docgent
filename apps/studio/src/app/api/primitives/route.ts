import { loadVocabulary } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

/**
 * GET /api/primitives
 *
 * Returns the complete Docgent vocabulary as machine-readable JSON.
 * Intended for agent consumers, autocomplete clients, and the /primitives
 * help page in Studio.
 *
 * No authentication required — the vocabulary is not sensitive.
 *
 * Response shape:
 * {
 *   version: string,         // from vocabulary.yaml
 *   blocks: BlockSpec[],
 *   inlines: InlineSpec[],
 *   frontmatter: { required, optional, enums }
 * }
 */
export async function GET() {
  try {
    const vocab = loadVocabulary();
    return Response.json({
      version: "1",
      blocks: vocab.blocks.map((b) => ({
        id: b.id,
        description: b.description,
        attrs: b.attrs,
      })),
      inlines: vocab.inlineIds,
      frontmatter: vocab.frontmatter,
    });
  } catch (err) {
    return Response.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
