/**
 * Document-level operations on top of the raw GitStore.
 *
 * GitStore knows about files and commits. This layer knows about DocForge
 * documents: where they live, what a version timeline means, and how to
 * commit an edit with proper attribution and a useful message.
 */
import { GitStore, NotFoundError } from "./index.mjs";

const DOC_ROOT = "documents";
const BRAND_ROOT = "brands";

/** Parses 'documents/vanaheim/q3-review/doc.md' -> {brand, slug}. */
export function parseDocPath(path) {
  const m = String(path).match(/^documents\/([^/]+)\/([^/]+)\//);
  return m ? { brand: m[1], slug: m[2] } : null;
}

export function docPath(brand, slug) {
  return `${DOC_ROOT}/${brand}/${slug}/doc.md`;
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
   */
  async listDocuments({ brand, ref } = {}) {
    const prefix = brand ? `${DOC_ROOT}/${brand}/` : `${DOC_ROOT}/`;
    const { entries, sha } = await this.git.tree({ ref, prefix });

    const docs = [];
    for (const e of entries) {
      if (e.type !== "file" || !e.path.endsWith("/doc.md")) continue;
      const parsed = parseDocPath(e.path);
      if (!parsed) continue;
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
    return { treeSha: sha, documents: docs.sort((a, b) => a.path.localeCompare(b.path)) };
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

/** Same frontmatter subset the validator and renderer use. */
export function parseFrontmatter(src) {
  const m = String(src).match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}
