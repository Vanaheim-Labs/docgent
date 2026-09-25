import { storesFor, findBrand } from "@/lib/store";

/** Public metadata allowlist shared by HTML, OG and the sign-in cover.
 * Never extract a description from protected source: summaries are not
 * necessarily public and native directives can contain embedded assets.
 * Store reads stay server-side; only the listed frontmatter leaves it. */

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
      description: [fm.doctype, fm.client ? `for ${fm.client}` : undefined,
        fm.status ? `(${fm.status})` : undefined].filter(Boolean).join(" ") || "A Docgent document.",
    };
  } catch {
    return null;
  }
}
