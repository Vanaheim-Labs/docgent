#!/usr/bin/env node
/**
 * Stages pipeline assets into apps/render-worker/pipeline/ so the Docker build
 * context is self-contained.
 *
 * The worker needs core templates/filters/css and every brand definition.
 * Rather than widening the Docker context to the whole monorepo, we copy the
 * exact subset in. Run this before `fly deploy`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "pipeline");
const FONTS = path.join(__dirname, "fonts");
// Same DOCGENT_BRANDS_DIR convention as packages/core/src/render.mjs and
// apps/studio/src/lib/store.ts — brand data may live outside this repo
// (private submodule), so the deploy staging step needs to find it there
// too rather than assuming ROOT/brands.
const BRANDS_ROOT = process.env.DOCGENT_BRANDS_DIR
  ? path.resolve(process.env.DOCGENT_BRANDS_DIR)
  : path.join(ROOT, "brands");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });

// core: templates, filters, css only — not src/
for (const sub of ["templates", "filters", "css"]) {
  const src = path.join(ROOT, "packages", "core", sub);
  if (fs.existsSync(src)) copyDir(src, path.join(OUT, "core", sub));
}

// brands: brand.yaml + css + assets, excluding documents
const brandsSrc = BRANDS_ROOT;
for (const brand of fs.readdirSync(brandsSrc)) {
  const bdir = path.join(brandsSrc, brand);
  if (!fs.statSync(bdir).isDirectory()) continue;
  copyDir(bdir, path.join(OUT, "brands", brand));
}

// fonts: core faces stay in apps/render-worker/fonts (shared baseline).
// Brand-specific faces live in brands/<id>/fonts and are collected here, so a
// brand carries its own typography instead of every brand sharing one pile.
fs.mkdirSync(FONTS, { recursive: true });
const gitkeep = path.join(FONTS, ".gitkeep");
if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, "");

const brandFontDir = path.join(OUT, "fonts");
const collected = [];
for (const brand of fs.readdirSync(brandsSrc)) {
  const fdir = path.join(brandsSrc, brand, "fonts");
  if (!fs.existsSync(fdir)) continue;
  const dest = path.join(brandFontDir, brand);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(fdir)) {
    if (!/\.(ttf|otf|woff2?)$/i.test(f)) continue;
    fs.copyFileSync(path.join(fdir, f), path.join(dest, f));
    collected.push(`${brand}/${f}`);
  }
}
if (collected.length) console.log(`brand fonts: ${collected.join(", ")}`);

const count = (dir) => {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else n++;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return n;
};

console.log(`staged ${count(OUT)} files into ${path.relative(ROOT, OUT)}`);
