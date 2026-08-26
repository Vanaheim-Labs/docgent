#!/usr/bin/env node
/**
 * Docgent core renderer.
 *   markdown (+frontmatter) -> pandoc -> semantic HTML -> WeasyPrint -> PDF
 *
 * Renderer is pluggable: implement the Renderer interface and register it.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseYaml, parseFrontmatter } from "./yaml.mjs";
import { lintHtml, lintPdf, summarise } from "./lint.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Where brand.yaml + assets/css/doctypes/fonts live.
 *
 * Defaults to ROOT/brands (the historical in-repo layout: fine for a fork
 * that keeps its own brands committed). DOCGENT_BRANDS_DIR overrides it so
 * brand config can live outside this repo entirely — e.g. a private git
 * submodule checked out elsewhere — which is how Vanaheim Labs runs this
 * same code against brand data that isn't in the public repo. Studio's
 * lib/store.ts resolves the same env var independently (it has its own
 * Vercel-bundling constraints); this is the CLI/renderer's equivalent.
 */
export const BRANDS_ROOT = process.env.DOCGENT_BRANDS_DIR
  ? path.resolve(process.env.DOCGENT_BRANDS_DIR)
  : path.join(ROOT, "brands");

const CORE = path.join(ROOT, "packages", "core");
const TEMPLATE = path.join(CORE, "templates", "document.html");
const FILTER = path.join(CORE, "filters", "vocabulary.lua");
// Microtypography runs after the vocabulary filter: it refines prose that the
// vocabulary filter may itself have emitted, and it must never see raw HTML
// before that HTML has been formed.
const MICROTYPE_FILTER = path.join(CORE, "filters", "microtype.lua");
const BASE_CSS = path.join(CORE, "css", "base.css");

export function readFrontmatter(mdPath) {
  return parseFrontmatter(fs.readFileSync(mdPath, "utf8"));
}

export function loadBrand(brandId) {
  const dir = path.join(BRANDS_ROOT, brandId);
  const yml = path.join(dir, "brand.yaml");
  if (!fs.existsSync(yml)) throw new Error(`Unknown brand '${brandId}' (no ${yml})`);
  return { id: brandId, dir, ...parseYaml(fs.readFileSync(yml, "utf8")) };
}

/* ---------------- brand -> document repo ---------------- */
/**
 * Resolves which GitHub repo holds a brand's documents.
 *
 * Precedence: explicit override > brand.yaml 'repo' > global default.
 * The override exists for testing and migrations; steady state is that the
 * brand declares its own repo, because a brand owned by another org must not
 * depend on a process-wide env var that some other brand also reads.
 */
export function brandRepo(brandId, { override } = {}) {
  if (override) return override;
  if (brandId) {
    try {
      const b = loadBrand(brandId);
      if (b.repo) return b.repo;
    } catch {}
  }
  const env = process.env.DOCGENT_REPO;
  if (env) return env;
  if (DEFAULT_REPO) return DEFAULT_REPO;
  throw new Error(
    brandId
      ? `Brand '${brandId}' declares no 'repo' in brand.yaml, and no --repo/DOCGENT_REPO override was given.`
      : "No brand given, so no document repo could be resolved. Pass --brand, --repo, or set DOCGENT_REPO."
  );
}

/**
 * No global default: documents live in per-brand repos, so guessing one would
 * mean silently committing a brand's documents into another brand's store.
 * A brand must declare 'repo', or the caller must pass an override.
 */
export const DEFAULT_REPO = null;

/** Lists every known brand and the repo it writes to. */
export function brandRepoMap() {
  const dir = BRANDS_ROOT;
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const id of fs.readdirSync(dir)) {
    try { out[id] = brandRepo(id); } catch {}
  }
  return out;
}

/* ---------------- brand tokens -> CSS custom properties ---------------- */
export function brandTokensCss(brand) {
  const t = brand.typography || {};
  const p = brand.palette || {};
  const pg = brand.page || {};

  // Brands carry palette keys core does not know about (North Face has
  // accent_bright, band, surface_*). Emit every key as a custom property so a
  // brand can extend its palette without a core change; the named defaults
  // below stay for the tokens core guarantees.
  const KNOWN = new Set(["ink","ink_soft","ink_faint","rule","paper","paper_alt",
    "accent","accent_soft","warning","warning_soft","risk","risk_soft","success","success_soft"]);
  const extraTokens = Object.entries(p)
    .filter(([k]) => !KNOWN.has(k))
    .map(([k, v]) => `  --${k.replace(/_/g, "-")}: ${v};`)
    .join("\n");
  const fam = (k) => t[k] || "";
  const bodyFam = t.body_family === "sans" ? fam("sans") : fam("serif");
  const headFam = t.heading_family === "serif" ? fam("serif") : fam("sans");

  return `:root {
  --font-serif: ${fam("serif")};
  --font-sans: ${fam("sans")};
  --font-mono: ${fam("mono")};
  --font-body: ${bodyFam};
  --font-heading: ${headFam};
  --base-size: ${t.base_size || "10.5pt"};
  --line-height: ${t.line_height || 1.55};

  --ink: ${p.ink || "#12161c"};
  --ink-soft: ${p.ink_soft || "#454e5a"};
  --ink-faint: ${p.ink_faint || "#8a94a1"};
  --rule: ${p.rule || "#dfe4ea"};
  --paper: ${p.paper || "#ffffff"};
  --paper-alt: ${p.paper_alt || "#f6f8fa"};
  --accent: ${p.accent || "#1f4b6e"};
  --accent-soft: ${p.accent_soft || "#e8f0f6"};
  --warning: ${p.warning || "#a35b12"};
  --warning-soft: ${p.warning_soft || "#fdf3e6"};
  --risk: ${p.risk || "#9b2c2c"};
  --risk-soft: ${p.risk_soft || "#fdecec"};
  --success: ${p.success || "#1f6b45"};
  --success-soft: ${p.success_soft || "#e9f5ef"};

${extraTokens ? extraTokens + "\n" : ""}  --section-numbering: ${brand.numbering && brand.numbering.sections === false ? "none" : "decimal"};
  --page-size: ${pg.size || "A4"};
  --margin-top: ${pg.margin_top || "22mm"};
  --margin-bottom: ${pg.margin_bottom || "20mm"};
  --margin-inner: ${pg.margin_inner || "24mm"};
  --margin-outer: ${pg.margin_outer || "20mm"};
}`;
}

function footerCss(brand, fm) {
  const name = (brand.name || "").replace(/"/g, '\\"');
  const cls = (fm.classification || "").toUpperCase().replace(/"/g, '\\"');
  return `@page { --footer-left: "${name}"; --footer-center: "${cls}"; }`;
}

/* ---------------- pipeline ---------------- */
export function mdToHtml(mdPath, { brand, frontmatter, outHtml, cssHrefs }) {
  const args = [
    mdPath,
    "--from", "markdown+yaml_metadata_block+fenced_divs+bracketed_spans+pipe_tables+footnotes+inline_notes+header_attributes+table_attributes+link_attributes+smart",
    "--to", "html5",
    "--standalone",
    "--template", TEMPLATE,
    "--lua-filter", FILTER,
    "--lua-filter", MICROTYPE_FILTER,
    "--section-divs",
    "--metadata", `brandname=${brand.name || brand.id}`,
    "-o", outHtml,
  ];

  // Brand cover logo — pass as a path relative to the brand assets dir so
  // WeasyPrint can resolve it via the baseUrl. The template uses $brandlogo$.
  const coverLogo = brand.cover && brand.cover.logo;
  if (coverLogo) {
    const logoPath = path.join(brand.dir, coverLogo);
    if (fs.existsSync(logoPath)) args.push("--metadata", `brandlogo=${logoPath}`);
  }

  // Deal/offer fields and the brand's display wording for the classification
  // level. Frontmatter carries the registry enum ('restricted'); the brand
  // decides how that reads on the page ('STRICTLY CONFIDENTIAL').
  const labels = brand.classification_labels || {};
  const label = labels[frontmatter.classification] ||
    String(frontmatter.classification || "").toUpperCase();
  if (label) args.push("--metadata", `classification_label=${label}`);
  for (const k of ["capital_sought", "instrument", "target_close", "contact"]) {
    if (frontmatter[k]) args.push("--metadata", `${k}=${frontmatter[k]}`);
  }
  if (frontmatter.toc) {
    const tocDepth = brand.toc?.depth ?? 2;
    args.push("--toc", `--toc-depth=${tocDepth}`);
  }
  for (const href of cssHrefs) args.push("--css", href);
  execFileSync("pandoc", args, { stdio: ["ignore", "pipe", "pipe"] });
  return outHtml;
}

export class WeasyPrintRenderer {
  static id = "weasyprint";
  render(htmlPath, pdfPath, { baseUrl }) {
    execFileSync("weasyprint", ["-u", baseUrl, htmlPath, pdfPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return pdfPath;
  }
}

export class ChromeRenderer {
  static id = "chrome";
  render(htmlPath, pdfPath) {
    const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    execFileSync(chrome, [
      "--headless", "--disable-gpu", "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    return pdfPath;
  }
}

const RENDERERS = { weasyprint: WeasyPrintRenderer, chrome: ChromeRenderer };

export function renderDocument(mdPath, opts = {}) {
  mdPath = path.resolve(mdPath);
  const fm = readFrontmatter(mdPath);
  const brandId = opts.brand || fm.brand;
  if (!brandId) throw new Error("No brand specified (frontmatter 'brand' or --brand).");
  const brand = loadBrand(brandId);

  const docDir = path.dirname(mdPath);
  const buildDir = opts.outDir || path.join(docDir, "build");
  fs.mkdirSync(buildDir, { recursive: true });

  const stem = opts.name || path.basename(mdPath, ".md");
  const tokensCss = path.join(buildDir, "_tokens.css");
  fs.writeFileSync(tokensCss, brandTokensCss(brand) + "\n" + footerCss(brand, fm));

  const brandCss = path.join(brand.dir, "css", "brand.css");
  const cssHrefs = [tokensCss, BASE_CSS];
  if (fs.existsSync(brandCss)) cssHrefs.push(brandCss);

  const outHtml = path.join(buildDir, `${stem}.html`);
  mdToHtml(mdPath, { brand, frontmatter: fm, outHtml, cssHrefs });

  const RendererClass = RENDERERS[opts.renderer || "weasyprint"];
  if (!RendererClass) throw new Error(`Unknown renderer '${opts.renderer}'`);
  const renderer = new RendererClass();
  const outPdf = path.join(buildDir, `${stem}.pdf`);
  renderer.render(outHtml, outPdf, { baseUrl: docDir + path.sep });

  // Render-time lint. Advisory: a document that lints badly still renders,
  // because a linter that blocks a draft is a linter people switch off.
  // Callers decide what to do with the findings.
  let lint = null;
  if (opts.lint !== false) {
    const findings = [
      ...lintHtml(fs.readFileSync(outHtml, "utf8")),
      ...lintPdf(fs.readFileSync(outPdf), {
        requireEvenPages: Boolean(brand.print && brand.print.even_pages),
      }),
    ];
    lint = summarise(findings);
  }

  return { html: outHtml, pdf: outPdf, brand: brand.id, frontmatter: fm, lint };
}
