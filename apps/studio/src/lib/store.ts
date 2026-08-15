/**
 * Bridge to the Phase 3 git-store.
 *
 * The package is plain ESM in the monorepo. Studio imports it directly rather
 * than duplicating logic, so Studio and the CLI cannot drift apart on what a
 * document or a version means.
 *
 * Documents live in per-brand repositories, not in the pipeline repo. Each
 * brand's `brand.yaml` declares its store via a `repo:` field, so a brand
 * owned by another org keeps its documents in that org and access follows
 * ownership. Resolution reads that file rather than a single env var.
 */
// Untyped ESM package in the monorepo; allowJs resolves it without types.
import { GitStore } from "../../../../packages/git-store/src/index.mjs";
import { DocumentStore } from "../../../../packages/git-store/src/documents.mjs";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";

/** Frontmatter fields the listing presents. Every one is optional: a
 *  document is still listable when its author has not filled these in. */
export type DocFrontmatter = {
  title?: string;
  subtitle?: string;
  doctype?: string;
  status?: string;
  classification?: string;
  version?: string;
  date?: string;
  author?: string;
};

export type DocSummary = {
  brand: string;
  brandName: string;
  slug: string;
  path: string;
  dir: string;
  blobSha: string;
  assets: string[];
  frontmatter: DocFrontmatter;
  /** Frontmatter title when present, else a humanised slug. Never a raw path. */
  title: string;
  /** Epoch ms parsed from frontmatter `date`, or null when absent/unparseable. */
  dateMs: number | null;
  /**
   * Who and when the last commit touched this document, and epoch ms for
   * sorting. Optional because it costs one extra API call per document — see
   * withLastCommit on listAllDocuments.
   */
  lastCommit?: {
    name: string;
    email: string | null;
    at: number | null;
    subject: string;
    /** True when the commit trailer names Docgent Studio as the author of
     *  the change — i.e. an accepted AI rewrite rather than hand-typed
     *  prose. Read from the commit message, not a database, so it survives
     *  clone and mirror the same way the rest of the history does. */
    isAgent: boolean;
  };
};

/**
 * Turns a slug into something readable for a document with no title.
 * A fallback, not a substitute: the point is that the index never shows a
 * bare identifier where a human expects a name.
 */
function titleFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Frontmatter `date` is free text ("August 2026", "2026-08-11", "7 Jul 2026").
 * Parse what Date understands and give up quietly otherwise, because a date we
 * cannot read should sort last rather than throw or fabricate an ordering.
 */
function parseDocDate(value: unknown): number | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return t;
  const m = raw.match(/^(\w+)\s+(\d{4})$/);
  if (m) {
    const t2 = Date.parse(`1 ${m[1]} ${m[2]}`);
    if (!Number.isNaN(t2)) return t2;
  }
  return null;
}

export type TimelineEntry = {
  sha: string;
  shortSha: string;
  subject: string;
  message: string;
  version: number;
  isCurrent: boolean;
  author: {
    name?: string;
    email?: string;
    date?: string;
    login?: string | null;
    avatar?: string | null;
  };
  url: string;
};

export type BrandAccess = { emails: string[]; domains: string[] };

export type Brand = { id: string; name: string; repo: string; access: BrandAccess };

/**
 * Locates the brands/ directory.
 *
 * This must not be derived from process.cwd(). Locally the server runs with
 * cwd = apps/studio, so cwd/../.. is the monorepo root and brands/ resolves.
 * On Vercel the serverless function runs with a different cwd, that same
 * expression points outside the bundle, readdirSync throws ENOENT, brands()
 * returns [], every findBrand() misses and storesFor() throws `Unknown brand`
 * — which the document route catches as notFound(). The result is that every
 * document 404s while the index still renders, because listAllDocuments()
 * swallows per-brand errors.
 *
 * So resolve from this module's own location and probe the candidates that
 * the dev, standalone and traced-serverless layouts each produce. The first
 * one that actually exists on disk wins; cwd is only a last resort.
 */
function resolveBrandsDir(): string {
  const here = (() => {
    try {
      // ESM at runtime.
      return dirname(fileURLToPath(import.meta.url));
    } catch {
      // CJS output, where __dirname exists instead.
      return typeof __dirname === "string" ? __dirname : process.cwd();
    }
  })();

  const candidates = [
    // Walk up from src/lib (dev) and from the compiled chunk (bundled).
    resolve(here, "..", "..", "brands"),
    resolve(here, "..", "..", "..", "brands"),
    resolve(here, "..", "..", "..", "..", "brands"),
    resolve(here, "..", "..", "..", "..", "..", "brands"),
    resolve(here, "..", "..", "..", "..", "..", "..", "brands"),
    // Vercel traces files under the task root preserving repo layout.
    join(process.cwd(), "brands"),
    join(process.cwd(), "..", "..", "brands"),
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  // Nothing found: return the historical path so the error message is familiar.
  return join(process.cwd(), "..", "..", "brands");
}

const BRANDS_DIR = process.env.DOCGENT_BRANDS_DIR
  ? resolve(process.env.DOCGENT_BRANDS_DIR)
  : resolveBrandsDir();

/**
 * Reads one scalar key from a brand.yaml.
 *
 * Deliberately not a YAML parser: brand.yaml is machine-written and the two
 * fields Studio needs are top-level scalars. Adding a YAML dependency to the
 * Vercel bundle to read two strings is not a trade worth making.
 */
function scalar(src: string, key: string): string | null {
  const m = src.match(new RegExp("^" + key + ":\\s*(.+?)\\s*$", "m"));
  if (!m) return null;
  return m[1].replace(/^["']|["']$/g, "").trim() || null;
}

/**
 * Reads the `access:` block from a brand.yaml.
 *
 * ```yaml
 * access:
 *   emails: [andrew@dcr.vc]
 *   domains: [inkl.com, influx.com]
 * ```
 *
 * Deliberately not a YAML parser — same reasoning as scalar() above. This
 * is the one nested block Studio needs, so a couple of targeted regexes
 * beat a dependency. Each key may be a flow list (`[a, b]`) or absent;
 * either produces an empty array rather than throwing.
 */
function accessBlock(src: string): BrandAccess {
  const section = src.match(/^access:\s*\n((?:[ \t]+.+\n?)*)/m)?.[1] ?? "";
  const list = (key: string): string[] => {
    const m = section.match(new RegExp("^[ \\t]+" + key + ":\\s*\\[([^\\]]*)\\]", "m"));
    if (!m) return [];
    return m[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, "").toLowerCase())
      .filter(Boolean);
  };
  return { emails: list("emails"), domains: list("domains") };
}

let brandCache: Brand[] | null = null;

/** Every brand the pipeline defines, with the repo that holds its documents. */
export function brands(): Brand[] {
  if (brandCache) return brandCache;

  const out: Brand[] = [];
  let dirs: string[] = [];
  try {
    dirs = readdirSync(BRANDS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return (brandCache = []);
  }

  for (const id of dirs.sort()) {
    let src: string;
    try {
      src = readFileSync(join(BRANDS_DIR, id, "brand.yaml"), "utf8");
    } catch {
      continue;
    }
    const repo = scalar(src, "repo");
    // A brand without a document store is a pipeline-only brand; skip it
    // rather than falling back to a shared repo and reading someone else's
    // documents.
    if (!repo) continue;
    out.push({ id, name: scalar(src, "name") || id, repo, access: accessBlock(src) });
  }

  return (brandCache = out);
}

export function findBrand(id: string): Brand | null {
  return brands().find((b) => b.id === id) ?? null;
}

/**
 * Whether a signed-in email is allowed into a given brand.
 *
 * Docgent is served from a single domain with the brand in the path
 * (docs.docgent.io/<brand>/<slug>), not one domain per brand — so isolation
 * is enforced per request against the path, not once at the DNS/host level.
 * Each brand's brand.yaml still owns its own access list; a person allowed
 * into 'inkl' is not automatically allowed into 'northface' just because
 * both checks now happen in the same place.
 */
export function emailAllowedForBrand(email: string, brandId: string): boolean {
  const brand = findBrand(brandId);
  if (!brand) return false;
  const addr = email.toLowerCase();
  if (brand.access.emails.includes(addr)) return true;
  const domain = addr.split("@")[1] || "";
  return brand.access.domains.includes(domain);
}

/** Every brand whose access list admits this email — used at sign-in time,
 *  where there is no destination path yet to check a single brand against. */
export function brandsForEmail(email: string): Brand[] {
  return brands().filter((b) => emailAllowedForBrand(email, b.id));
}

/**
 * Agent bearer-token check, for callers that are not a signed-in human.
 *
 * Mirrors the existing DOCGENT_GH_TOKEN_<ID> env convention (see
 * resolveToken in the CLI): one token per brand, in
 * DOCGENT_AGENT_TOKEN_<BRAND_ID_UPPER>. There is no shared/global agent
 * token by design — a leaked Inkl token must never grant Northface access,
 * same boundary the human access lists already enforce.
 *
 * Tokens are plain opaque secrets set as deployment env vars, not stored in
 * brand.yaml (which is committed) or in the documents repo. Comparison is
 * timing-safe so response latency cannot be used to brute-force a token
 * character by character.
 */
export function agentTokenValidForBrand(token: string, brandId: string): boolean {
  const envKey = "DOCGENT_AGENT_TOKEN_" + brandId.toUpperCase();
  const expected = process.env[envKey];
  if (!expected) return false; // no token configured for this brand: fail closed
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch rather than returning false;
  // a length check first is not itself a timing leak worth worrying about
  // here (brand tokens are fixed-length random secrets, not user input
  // whose length is itself sensitive).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Fixed commit identity for agent-authenticated writes, distinct per brand
 *  so "who touched this" stays meaningful in the timeline (see DocSummary's
 *  lastCommit.isAgent, which already special-cases "Docgent Studio" — this
 *  is the token-authenticated sibling of that same idea). */
export function agentAuthorForBrand(brandId: string): { name: string; email: string } {
  return { name: "Docgent Agent (" + brandId + ")", email: "agent+" + brandId + "@docgent.local" };
}

// Keyed by brand: a single shared instance would serve one brand's documents
// under another brand's route.
const cached = new Map<string, { git: any; docs: any; brand: Brand }>();

/** Git and document stores for one brand. */
export function storesFor(brandId: string) {
  const hit = cached.get(brandId);
  if (hit) return hit;

  const token = process.env.DOCGENT_GH_TOKEN;
  if (!token) throw new Error("DOCGENT_GH_TOKEN is not set");

  const brand = findBrand(brandId);
  if (!brand) throw new Error(`Unknown brand '${brandId}'`);

  const [owner, repo] = brand.repo.split("/");
  const branch = process.env.DOCGENT_BRANCH || "main";

  const git = new GitStore({ owner, repo, token, branch });
  const entry = { git, docs: new DocumentStore(git), brand };
  cached.set(brandId, entry);
  return entry;
}

/**
 * Every document across every brand.
 *
 * One request per store, in parallel. A brand whose repo is unreachable is
 * reported rather than failing the whole listing, so one broken store does
 * not blank the index.
 */
export async function listAllDocuments(
  { withLastCommit = false }: { withLastCommit?: boolean } = {}
): Promise<{
  documents: DocSummary[];
  errors: { brand: string; message: string }[];
}> {
  const documents: DocSummary[] = [];
  const errors: { brand: string; message: string }[] = [];

  await Promise.all(
    brands().map(async (b) => {
      try {
        const { docs } = storesFor(b.id);
        // Frontmatter is what makes the index readable — titles, status and
        // dates instead of slugs and repo paths.
        const res = await docs.listDocuments({ brand: b.id, withFrontmatter: true });
        for (const d of res.documents) {
          const fm: DocFrontmatter = d.frontmatter || {};
          // Flat per-brand stores carry no brand path segment; the repo is
          // the brand, so stamp it here for routing.
          documents.push({
            ...d,
            brand: d.brand || b.id,
            brandName: b.name,
            frontmatter: fm,
            title: (fm.title && String(fm.title).trim()) || titleFromSlug(d.slug),
            dateMs: parseDocDate(fm.date),
          });
        }
      } catch (e) {
        errors.push({
          brand: b.id,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })
  );

  // Most recent first within a brand: the document someone wants is nearly
  // always the one most recently dated, not the one earliest in the alphabet.
  // Undated documents sort after dated ones rather than jumping to the top.
  documents.sort(
    (a, b) =>
      a.brand.localeCompare(b.brand) ||
      (b.dateMs ?? -Infinity) - (a.dateMs ?? -Infinity) ||
      a.title.localeCompare(b.title)
  );

  // The work queue reads "who last touched this" from the commit, not from
  // frontmatter — an accepted AI rewrite does not update `author:`, so
  // frontmatter would keep crediting whoever wrote the document originally.
  // One history call per document; opt-in because the library page needs it
  // and nothing else does, and it is the one part of this listing that
  // cannot be served from a single tree read.
  if (withLastCommit) {
    await Promise.all(
      documents.map(async (d) => {
        try {
          const { docs } = storesFor(d.brand);
          const [entry] = await docs.timeline(d.brand, d.slug, { limit: 1 });
          if (!entry) return;
          const subject = String(entry.subject || entry.message || "").trim();
          d.lastCommit = {
            name: entry.author?.name || entry.author?.login || "Unknown",
            email: entry.author?.email ?? null,
            at: entry.author?.date ? Date.parse(entry.author.date) : null,
            subject,
            // Every commit Studio makes on an author's behalf carries this
            // trailer — see the rewrite accept route and the save route.
            isAgent: /Generated-by:\s*Docgent Studio/i.test(entry.message || ""),
          };
        } catch {
          // A history call failing for one document should not blank its row;
          // the row just renders without last-touched detail.
        }
      })
    );
  }

  return { documents, errors };
}

/** The repo backing a brand, for display. */
export function repoSlug(brandId?: string) {
  if (!brandId) return "docgent";
  return findBrand(brandId)?.repo ?? "unknown";
}
