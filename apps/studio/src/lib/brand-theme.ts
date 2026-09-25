/**
 * Brand palette + typography extracted from brand.yaml for use in the OG
 * image renderer and any other surface that needs visual brand identity.
 *
 * We deliberately avoid adding a YAML parser dependency (same reasoning as
 * the scalar/accessBlock parsers in store.ts). brand.yaml palette entries
 * follow a fixed format — `  key: "#rrggbb"` — so a couple of targeted
 * regexes are enough and will survive any reformatting that leaves the
 * structure intact.
 *
 * The module also knows how to fetch a brand's logo SVG from GitHub (the
 * docgent-brands repo), returning it as a base64 data URI ready to embed
 * in an <img> tag inside Satori. Falls back gracefully when no logo exists.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BrandTheme = {
  /** Resolved hex colours from the brand palette. */
  palette: {
    band: string;       // dark header / gradient base (dark ground)
    accent: string;     // primary brand accent colour
    accentSoft: string; // pale tinted version of accent (for pills etc.)
    ink: string;        // main text colour on light ground
    paper: string;      // background on light surfaces
  };
  /** CSS font-family stack for headings (the brand's "voice"). */
  headingFont: string;
  /** Whether the band colour is dark (true) or light (false). Controls
   *  text contrast — almost always true for document brands. */
  darkBand: boolean;
  /** Optional logo as a base64 PNG/SVG data URI for embedding in Satori.
   *  Null when the brand has no logo or it could not be fetched. */
  logoDataUri: string | null;
  /** Filename hint for which logo variant was fetched (informational). */
  logoFile: string | null;
};

// ─── Defaults ─────────────────────────────────────────────────────────────────

/** Safe fallback when a brand has no theme or its yaml is unreadable. */
const DEFAULT_THEME: BrandTheme = {
  palette: {
    band: "#0b1e30",
    accent: "#4a9eda",
    accentSoft: "#1a4d70",
    ink: "#ffffff",
    paper: "#ffffff",
  },
  headingFont: '"Inter", "Helvetica Neue", Arial, sans-serif',
  darkBand: true,
  logoDataUri: null,
  logoFile: null,
};

// ─── Parsing ──────────────────────────────────────────────────────────────────

/** Extract a palette colour by key name. Returns null if absent. */
function paletteColor(yaml: string, key: string): string | null {
  // Matches lines like `  accent: "#FF5E17"` or `  accent: '#FF5E17'`
  // indented under `palette:`, not a sub-key like `accent_soft:`.
  const re = new RegExp(`^  ${key}:\\s*["']?(#[0-9a-fA-F]{3,8})["']?`, "m");
  const m = yaml.match(re);
  return m ? m[1] : null;
}

/** Extract a top-level scalar. Mirrors store.ts scalar() exactly. */
function scalar(yaml: string, key: string): string | null {
  const m = yaml.match(new RegExp("^" + key + ":\\s*(.+?)\\s*$", "m"));
  if (!m) return null;
  return m[1].replace(/^["']|["']$/g, "").trim() || null;
}

/** Extract a typography block value (e.g. `  sans:`, `  serif:`,
 *  `  heading_family:`). */
function typoValue(yaml: string, key: string): string | null {
  const re = new RegExp(`^  ${key}:\\s*["']?(.+?)["']?\\s*$`, "m");
  const m = yaml.match(re);
  return m ? m[1].trim() : null;
}

/** Returns true if a hex colour is perceptually dark (luminance < 0.3). */
function isHexDark(hex: string): boolean {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  // sRGB relative luminance (simplified gamma)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 0.3;
}

/** Derive heading font-family from the typography block. */
function resolveHeadingFont(yaml: string): string {
  const headingFamily = typoValue(yaml, "heading_family"); // "serif" | "sans"
  const serifStack = typoValue(yaml, "serif");
  const sansStack = typoValue(yaml, "sans");
  if (headingFamily === "serif" && serifStack) return serifStack;
  if (headingFamily === "sans" && sansStack) return sansStack;
  // Fallback: prefer serif if present, else sans
  return serifStack || sansStack || '"Inter", "Helvetica Neue", Arial, sans-serif';
}

// ─── Brands dir resolution (mirrors store.ts BRANDS_DIR) ─────────────────────

/**
 * Find the brands directory. Mirrors the probe logic in store.ts so both
 * modules resolve to the same path without importing from each other (which
 * would pull in node:fs usage into the OG edge runtime if we're not careful).
 */
function findBrandsDir(): string | null {
  if (process.env.DOCGENT_BRANDS_DIR) return process.env.DOCGENT_BRANDS_DIR;

  const candidates = [
    // Relative to this source file at src/lib/brand-theme.ts (dev)
    join(__dirname, "..", "..", "..", "..", "brands"),
    join(__dirname, "..", "..", "..", "..", "..", "brands"),
    // Render-worker pipeline brands (authoritative config; present in dev checkout)
    join(__dirname, "..", "..", "..", "..", "..", "apps", "render-worker", "pipeline", "brands"),
    join(__dirname, "..", "..", "..", "..", "apps", "render-worker", "pipeline", "brands"),
    // Vercel serverless cwd paths
    join(process.cwd(), "brands"),
    join(process.cwd(), "..", "brands"),
    join(process.cwd(), "..", "..", "brands"),
    // Vercel: render-worker brands bundled via outputFileTracingIncludes
    join(process.cwd(), "..", "render-worker", "pipeline", "brands"),
    join(process.cwd(), "apps", "render-worker", "pipeline", "brands"),
    "/var/task/brands",
    "/var/task/apps/render-worker/pipeline/brands",
  ];
  for (const c of candidates) {
    try {
      // Only count a dir that actually has at least one brand.yaml in it
      const entries = readdirSync(c, { withFileTypes: true });
      if (entries.some((e) => e.isDirectory() && existsSync(join(c, e.name, "brand.yaml"))))
        return c;
    } catch { /* not found */ }
  }
  return null;
}

/** Read brand.yaml text from disk. Returns null if not found. */
function readBrandYaml(brandId: string): string | null {
  const dir = findBrandsDir();
  if (!dir) return null;
  const path = join(dir, brandId, "brand.yaml");
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// ─── Logo fetching ────────────────────────────────────────────────────────────

/** Decide which logo variant to prefer for a dark-band OG image. */
function preferredLogoFile(yaml: string, dark: boolean): string | null {
  // cover.logo is the primary hint
  const coverLogo = (() => {
    const m = yaml.match(/^  logo:\s*(.+?)\s*$/m);
    return m ? m[1].replace(/^["']|["']$/g, "").trim() : null;
  })();
  if (dark) {
    // Prefer the white variant when we know it exists (inkl pattern)
    // We'll probe both and fall back gracefully in fetchLogoDataUri.
    return coverLogo?.replace(/\.svg$/, "-white.svg") || coverLogo || "assets/logo-white.svg";
  }
  return coverLogo || "assets/logo.svg";
}

/**
 * Fetches a brand logo from the docgent-brands GitHub repo and returns it
 * as a base64-encoded SVG data URI. Returns null on any failure (missing
 * logo, auth issue, network error) so the caller can degrade to text.
 *
 * Probe order for dark band:
 *   1. assets/logo-white.svg  (prefer white for dark ground)
 *   2. assets/logo.svg        (fallback)
 */
export async function fetchLogoDataUri(
  brandId: string,
  yaml: string,
  darkBand: boolean
): Promise<{ uri: string; file: string } | null> {
  const readToken =
    process.env.DOCGENT_BRANDS_WRITE_TOKEN || process.env.DOCGENT_BRANDS_TOKEN;
  if (!readToken) return null;

  const repoRef = process.env.DOCGENT_BRANDS_REPO ?? "Vanaheim-Labs/docgent-brands";
  const [owner, repo] = repoRef.split("/");
  const branch = process.env.DOCGENT_BRANCH ?? "main";

  const preferred = preferredLogoFile(yaml, darkBand);
  // Candidates: preferred first, then the other variant
  const candidates = preferred?.endsWith("-white.svg")
    ? [preferred, preferred.replace("-white.svg", ".svg")]
    : preferred
    ? [preferred, preferred.replace(".svg", "-white.svg")]
    : ["assets/logo-white.svg", "assets/logo.svg"];

  for (const file of candidates) {
    const path = `${brandId}/${file}`;
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `token ${readToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { content?: string; encoding?: string };
      if (!data.content) continue;
      const raw = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
      // Return as SVG data URI (Satori supports inline SVG via <img src="data:...">)
      const b64 = Buffer.from(raw).toString("base64");
      return { uri: `data:image/svg+xml;base64,${b64}`, file };
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Brand YAML from Git fallback ───────────────────────────────────────────

/**
 * Fetch brand.yaml text from the docgent-brands GitHub repo.
 * Used as fallback when the local brands/ directory is absent (Vercel production).
 */
async function fetchBrandYamlFromGit(brandId: string): Promise<string | null> {
  const readToken =
    process.env.DOCGENT_BRANDS_WRITE_TOKEN || process.env.DOCGENT_BRANDS_TOKEN;
  if (!readToken) return null;

  const repoRef = process.env.DOCGENT_BRANDS_REPO ?? "Vanaheim-Labs/docgent-brands";
  const [owner, repo] = repoRef.split("/");
  const branch = process.env.DOCGENT_BRANCH ?? "main";

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${brandId}/brand.yaml?ref=${branch}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `token ${readToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string };
    if (!data.content) return null;
    return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
  } catch {
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Builds a BrandTheme for the given brand, loading brand.yaml from disk and
 * optionally fetching the logo from GitHub.
 *
 * @param brandId       The brand id (e.g. "inkl", "laurion")
 * @param fetchLogo     When true, fetches the logo from the brands repo.
 *                      Set false for cache-warm paths that don't need it.
 */
export async function getBrandTheme(
  brandId: string,
  fetchLogo = true
): Promise<BrandTheme> {
  // Try disk first (dev); fall back to GitHub API (Vercel production where
  // brands/ isn't bundled into the serverless function).
  const yaml = readBrandYaml(brandId) ?? await fetchBrandYamlFromGit(brandId);
  if (!yaml) return DEFAULT_THEME;

  // Palette
  const band = paletteColor(yaml, "band") || paletteColor(yaml, "ink") || DEFAULT_THEME.palette.band;
  const accent = paletteColor(yaml, "accent") || DEFAULT_THEME.palette.accent;
  const accentSoft =
    paletteColor(yaml, "accent_soft") ||
    // Derive a soft version by darkening the accent slightly for use on dark ground
    DEFAULT_THEME.palette.accentSoft;
  const ink = paletteColor(yaml, "ink") || DEFAULT_THEME.palette.ink;
  const paper = paletteColor(yaml, "paper") || DEFAULT_THEME.palette.paper;

  const darkBand = isHexDark(band);
  const headingFont = resolveHeadingFont(yaml);

  let logoDataUri: string | null = null;
  let logoFile: string | null = null;

  if (fetchLogo) {
    const result = await fetchLogoDataUri(brandId, yaml, darkBand);
    if (result) {
      logoDataUri = result.uri;
      logoFile = result.file;
    }
  }

  return {
    palette: { band, accent, accentSoft, ink, paper },
    headingFont,
    darkBand,
    logoDataUri,
    logoFile,
  };
}
