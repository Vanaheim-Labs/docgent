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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type DocSummary = {
  brand: string;
  slug: string;
  path: string;
  dir: string;
  blobSha: string;
  assets: string[];
};

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

export type Brand = { id: string; name: string; repo: string };

const BRANDS_DIR = join(process.cwd(), "..", "..", "brands");

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
    out.push({ id, name: scalar(src, "name") || id, repo });
  }

  return (brandCache = out);
}

export function findBrand(id: string): Brand | null {
  return brands().find((b) => b.id === id) ?? null;
}

// Keyed by brand: a single shared instance would serve one brand's documents
// under another brand's route.
const cached = new Map<string, { git: any; docs: any; brand: Brand }>();

/** Git and document stores for one brand. */
export function storesFor(brandId: string) {
  const hit = cached.get(brandId);
  if (hit) return hit;

  const token = process.env.DOCFORGE_GH_TOKEN;
  if (!token) throw new Error("DOCFORGE_GH_TOKEN is not set");

  const brand = findBrand(brandId);
  if (!brand) throw new Error(`Unknown brand '${brandId}'`);

  const [owner, repo] = brand.repo.split("/");
  const branch = process.env.DOCFORGE_BRANCH || "main";

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
export async function listAllDocuments(): Promise<{
  documents: DocSummary[];
  errors: { brand: string; message: string }[];
}> {
  const documents: DocSummary[] = [];
  const errors: { brand: string; message: string }[] = [];

  await Promise.all(
    brands().map(async (b) => {
      try {
        const { docs } = storesFor(b.id);
        const res = await docs.listDocuments({ brand: b.id });
        for (const d of res.documents) {
          // Flat per-brand stores carry no brand path segment; the repo is
          // the brand, so stamp it here for routing.
          documents.push({ ...d, brand: d.brand || b.id });
        }
      } catch (e) {
        errors.push({
          brand: b.id,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })
  );

  documents.sort(
    (a, b) => a.brand.localeCompare(b.brand) || a.slug.localeCompare(b.slug)
  );
  return { documents, errors };
}

/** The repo backing a brand, for display. */
export function repoSlug(brandId?: string) {
  if (!brandId) return "docforge";
  return findBrand(brandId)?.repo ?? "unknown";
}
