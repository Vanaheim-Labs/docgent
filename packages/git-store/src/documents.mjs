/**
 * Document-level operations on top of the raw GitStore.
 *
 * GitStore knows about files and commits. This layer knows about Docgent
 * documents: where they live, what a version timeline means, and how to
 * commit an edit with proper attribution and a useful message.
 */
import { GitStore, NotFoundError } from "./index.mjs";
import { parseFrontmatter } from "@docgent/core/yaml";

const DOC_ROOT = "documents";
const BRAND_ROOT = "brands";

/**
 * Parses a document path into {brand, slug}.
 *
 * Two layouts are supported:
 *   documents/<slug>/doc.md          per-brand store (current)
 *   documents/<brand>/<slug>/doc.md  legacy, when all brands shared one repo
 *
 * In a per-brand store the repo already identifies the brand, so repeating it
 * in the path is redundant. The caller supplies the brand it asked for; the
 * nested form is still parsed so older repos keep working.
 */
export function parseDocPath(path, brandHint) {
  const s = String(path);
  const nested = s.match(/^documents\/([^/]+)\/([^/]+)\/(?:doc\.md|assets\/)/);
  if (nested) return { brand: nested[1], slug: nested[2] };
  const flat = s.match(/^documents\/([^/]+)\/(?:doc\.md|assets\/)/);
  if (flat) return { brand: brandHint || null, slug: flat[1] };
  return null;
}

/** Path for a document within its store. Flat unless a nested layout is forced. */
export function docPath(brand, slug, { nested = false } = {}) {
  return nested
    ? `${DOC_ROOT}/${brand}/${slug}/doc.md`
    : `${DOC_ROOT}/${slug}/doc.md`;
}

export class DocumentStore {
  constructor(gitStore) {
    if (!(gitStore instanceof GitStore)) {
      throw new TypeError("DocumentStore requires a GitStore");
    }
    this.git = gitStore;
  }

  /** Every brand that has a brand.yaml. */
  async listBrands({ ref } = {}) {
    const { entries } = await this.git.tree({ ref, prefix: BRAND_ROOT + "/" });
    const brands = new Set();
    for (const e of entries) {
      const m = e.path.match(/^brands\/([^/]+)\/brand\.yaml$/);
      if (m) brands.add(m[1]);
    }
    return [...brands].sort();
  }

  /**
   * Every document, optionally filtered by brand.
   * One tree call rather than a directory walk per brand.
   *
   * `withFrontmatter` additionally fetches each doc.md blob so callers get the
   * document's own title, status and date rather than having to present a
   * slug and a repo path. That costs one blob read per document, so it is
   * opt-in: bulk callers that only need paths keep the single-call behaviour.
   */
  async listDocuments({ brand, ref, withFrontmatter = false } = {}) {
    // Per-brand stores are flat (documents/<slug>/), so the brand is not a
    // path segment to filter on — it identifies the repo, not the directory.
    // Scan the whole document root and let parseDocPath sort out the layout.
    const { entries, sha } = await this.git.tree({ ref, prefix: `${DOC_ROOT}/` });

    const docs = [];
    for (const e of entries) {
      if (e.type !== "file" || !e.path.endsWith("/doc.md")) continue;
      const parsed = parseDocPath(e.path, brand);
      if (!parsed) continue;
      // Legacy nested stores hold several brands in one repo; honour the filter.
      if (brand && parsed.brand && parsed.brand !== brand) continue;
      const dir = e.path.replace(/\/doc\.md$/, "");
      docs.push({
        brand: parsed.brand,
        slug: parsed.slug,
        path: e.path,
        dir,
        blobSha: e.sha,
        assets: entries
          .filter((a) => a.type === "file" && a.path.startsWith(dir + "/assets/"))
          .map((a) => a.path.slice(dir.length + 1)),
      });
    }
    docs.sort((a, b) => a.path.localeCompare(b.path));

    if (withFrontmatter) {
      // In parallel: the listing is a page load, not a batch job. A document
      // whose blob fails to read still lists, with empty frontmatter, because
      // one unreadable file should not blank the index.
      await Promise.all(
        docs.map(async (d) => {
          try {
            const blob = await this.git.readBlob(d.blobSha);
            d.frontmatter = parseFrontmatter(blob);
          } catch {
            d.frontmatter = {};
          }
        })
      );
    }

    return { treeSha: sha, documents: docs };
  }

  /** Reads a document plus its parsed frontmatter. */
  async readDocument(brand, slug, { ref } = {}) {
    const path = docPath(brand, slug);
    const file = await this.git.readFile(path, { ref });
    return {
      brand,
      slug,
      path,
      content: file.content,
      sha: file.sha,
      frontmatter: parseFrontmatter(file.content),
    };
  }

  /**
   * Saves an edit. `baseSha` is the blob SHA the editor loaded, so a human in
   * Studio cannot silently overwrite an agent's concurrent commit.
   */
  async saveDocument(brand, slug, content, { baseSha, author, message } = {}) {
    const path = docPath(brand, slug);
    const fm = parseFrontmatter(content);
    const subject =
      message ||
      `${fm.title ? `docs(${brand}/${slug}): ${truncate(fm.title, 60)}` : `docs(${brand}/${slug}): update`}`;

    return this.git.writeFile(path, content, {
      message: subject,
      sha: baseSha,
      author,
    });
  }

  /** Creates a document. Fails if one already exists at that path. */
  async createDocument(brand, slug, content, { author } = {}) {
    const path = docPath(brand, slug);
    try {
      await this.git.readFile(path);
      throw new Error(`document already exists: ${brand}/${slug}`);
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
    return this.git.writeFile(path, content, {
      message: `docs(${brand}/${slug}): create`,
      author,
    });
  }

  /**
   * Version timeline for a document. Each entry is a renderable point in
   * history — Phase 6 will attach a content-addressed PDF to each one.
   */
  async timeline(brand, slug, { limit = 50 } = {}) {
    const path = docPath(brand, slug);
    const commits = await this.git.history(path, { limit });
    return commits.map((c, i) => ({
      ...c,
      version: commits.length - i,
      isCurrent: i === 0,
    }));
  }

  /** Document content as at a given commit. */
  async readAt(brand, slug, commitSha) {
    const path = docPath(brand, slug);
    const file = await this.git.readFileAt(path, commitSha);
    return {
      brand,
      slug,
      path,
      commitSha,
      content: file.content,
      frontmatter: parseFrontmatter(file.content),
    };
  }

  /** Diff of a single document between two commits. */
  async diffDocument(brand, slug, baseSha, headSha) {
    const path = docPath(brand, slug);
    return this.git.diff(baseSha, headSha, { path });
  }
}

/* ---------------------------------------------------------------- */

function truncate(s, n) {
  const t = String(s).trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

/** Re-exported so the validator, renderer and git-store agree exactly. */
export { parseFrontmatter };
