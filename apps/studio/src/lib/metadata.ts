import { storesFor, findBrand } from "@/lib/store";

/**
 * Metadata for link previews (Slack, iMessage, WhatsApp, Twitter, etc.).
 *
 * Deliberately independent of session/auth: link-preview crawlers never
 * sign in, so this reads the same way the API layer does - directly via
 * storesFor(), which uses the server's own DOCGENT_GH_TOKEN rather than a
 * user's session. That is safe because everything returned here only ever
 * goes into <head> meta tags and a small generated preview image; it never
 * reaches a page body a crawler could scrape into full content.
 *
 * A document's frontmatter has no dedicated `description` field (see
 * brands/<brand>/doctypes/<name>.md), so the description is derived: prefer the
 * `::: summary` block's first paragraph (the "Executive summary" callout
 * every doctype template opens with), else the first non-empty paragraph
 * of the body, else a generic sentence built from doctype/brand.
 */

export type DocPreviewMeta = {
  brand: string;
  brandName: string;
  slug: string;
  title: string;
  subtitle?: string;
  doctype?: string;
  status?: string;
  classification?: string;
  version?: string;
  date?: string;
  author?: string;
  client?: string;
  description: string;
};

/** Strips the handful of inline vocabulary marks (bold/italic/code/links)
 *  a description might otherwise carry verbatim into a meta tag. */
function stripInlineMarkup(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pulls the first paragraph out of a `::: summary` ... `:::` fenced block,
 *  if the document has one. Returns null if there is no summary block or it
 *  has no text content. Operates on raw content — frontmatter is irrelevant
 *  here because the summary block always appears in the body. */
function extractSummaryBlock(content: string): string | null {
  const match = content.match(/:::\s*summary\s*\n([\s\S]*?)\n:::/);
  if (!match) return null;
  const body = match[1];
  const paragraph = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p.length > 0 && !p.startsWith("#"));
  return paragraph ? stripInlineMarkup(paragraph) : null;
}

/** Strips the YAML frontmatter block (--- ... ---) from raw document content,
 *  returning only the body. Safe to call even when no frontmatter is present. */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---[\s\S]*?\n---\s*\n/);
  return match ? content.slice(match[0].length) : content;
}

/** Falls back to the first real paragraph of the document body - skipping
 *  frontmatter, headings, and block fences - when there is no summary block
 *  to use instead. */
function extractFirstParagraph(content: string): string | null {
  const body = stripFrontmatter(content);
  const lines = body.split("\n");
  const buffer: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith(":::")) {
      if (buffer.length) break;
      continue;
    }
    if (!trimmed) {
      if (buffer.length) break;
      continue;
    }
    buffer.push(trimmed);
  }
  const paragraph = buffer.join(" ").trim();
  return paragraph ? stripInlineMarkup(paragraph) : null;
}

const MAX_DESCRIPTION_LENGTH = 200;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

function buildDescription(
  content: string,
  fm: { doctype?: string; client?: string; status?: string }
): string {
  const fromSummary = extractSummaryBlock(content);
  if (fromSummary) return truncate(fromSummary, MAX_DESCRIPTION_LENGTH);

  const fromBody = extractFirstParagraph(content);
  if (fromBody) return truncate(fromBody, MAX_DESCRIPTION_LENGTH);

  const parts = [fm.doctype, fm.client ? `for ${fm.client}` : undefined, fm.status ? `(${fm.status})` : undefined].filter(
    Boolean
  );
  return parts.length ? parts.join(" ") : "A Docgent document.";
}

/**
 * Reads just enough of a document to build link-preview metadata. Returns
 * null when the brand or document doesn't exist or isn't reachable - the
 * caller falls back to generic site metadata rather than throwing, since a
 * bad preview is fine but a crashed one is not.
 */
export async function fetchDocPreviewMeta(
  brand: string,
  slug: string,
  ref?: string
): Promise<DocPreviewMeta | null> {
  const brandInfo = findBrand(brand);
  if (!brandInfo) return null;

  try {
    const { docs } = await storesFor(brand);
    const doc = ref ? await docs.readAt(brand, slug, ref) : await docs.readDocument(brand, slug);
    const fm = doc.frontmatter || {};

    return {
      brand,
      brandName: brandInfo.name,
      slug,
      title: fm.title || slug,
      subtitle: fm.subtitle || undefined,
      doctype: fm.doctype || undefined,
      status: fm.status || undefined,
      classification: fm.classification || undefined,
      version: fm.version || undefined,
      date: fm.date || undefined,
      author: fm.author || undefined,
      client: fm.client || undefined,
      description: buildDescription(doc.content || "", fm),
    };
  } catch {
    return null;
  }
}
