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
const brandsSrc = path.join(ROOT, "brands");
for (const brand of fs.readdirSync(brandsSrc)) {
  const bdir = path.join(brandsSrc, brand);
  if (!fs.statSync(bdir).isDirectory()) continue;
  copyDir(bdir, path.join(OUT, "brands", brand));
}

// fonts dir must exist for the Dockerfile COPY to succeed
fs.mkdirSync(FONTS, { recursive: true });
const gitkeep = path.join(FONTS, ".gitkeep");
if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, "");

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
