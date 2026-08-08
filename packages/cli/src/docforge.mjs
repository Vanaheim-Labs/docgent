#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDocument, ROOT, loadBrand } from "../../core/src/render.mjs";
import { validateDoc } from "../../vocabulary/src/validate.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];

function flag(name, def) {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? def : argv[i + 1];
}
function bool(name) { return argv.includes(`--${name}`); }

// Flags that are pure switches — they take no value, so the next argv entry
// is a positional rather than the flag's argument.
const BOOLEAN_FLAGS = new Set(["remote", "strict"]);

function positional() {
  const out = [];
  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2).split("=")[0];
      // '--flag=value' carries its own value; switches consume nothing.
      i += arg.includes("=") || BOOLEAN_FLAGS.has(name) ? 1 : 2;
      continue;
    }
    out.push(arg);
    i += 1;
  }
  return out;
}

const HELP = `docforge — multi-brand document production

  docforge new --brand <id> --type <doctype> --title "..." [--slug <slug>]
  docforge validate <file.md> [...]
  docforge render <file.md> [--renderer weasyprint|chrome] [--out <dir>]
  docforge render <file.md> --remote [--url <worker>] [--key <secret>]
  docforge health [--url <worker>] [--key <secret>]
  docforge brands
  docforge docs

Remote rendering uses the render worker (see apps/render-worker), so output
matches production regardless of what is installed locally.
Env: DOCFORGE_RENDER_URL, DOCFORGE_API_KEY
`;

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

switch (cmd) {
  case "brands": {
    const dir = path.join(ROOT, "brands");
    for (const b of fs.readdirSync(dir)) {
      try {
        const brand = loadBrand(b);
        console.log(`${b.padEnd(14)} ${brand.name || ""}`);
      } catch {}
    }
    break;
  }

  case "docs": {
    const dir = path.join(ROOT, "documents");
    for (const brand of fs.readdirSync(dir)) {
      const bdir = path.join(dir, brand);
      if (!fs.statSync(bdir).isDirectory()) continue;
      for (const d of fs.readdirSync(bdir)) {
        const md = path.join(bdir, d, "doc.md");
        if (fs.existsSync(md)) console.log(`${brand}/${d}`);
      }
    }
    break;
  }

  case "new": {
    const brand = flag("brand");
    const doctype = flag("type", "Report");
    const title = flag("title", "Untitled Document");
    if (!brand) { console.error("--brand required"); process.exit(2); }
    loadBrand(brand);
    const slug = flag("slug", slugify(title));
    const dir = path.join(ROOT, "documents", brand, slug);
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const md = `---
title: "${title}"
subtitle: ""
brand: ${brand}
doctype: "${doctype}"
version: "0.1.0"
date: "${today}"
client: ""
author: ""
classification: internal
status: draft
toc: true
---

::: summary
## Executive summary

One paragraph stating the conclusion. Write this last.
:::

# Introduction

Body copy goes here.
`;
    fs.writeFileSync(path.join(dir, "doc.md"), md);
    console.log(dir);
    break;
  }

  case "validate": {
    const targets = positional();
    let failed = 0;
    for (const t of targets) {
      const r = validateDoc(path.resolve(t));
      if (r.ok && !r.warnings.length) console.log(`✓ ${t}`);
      else {
        if (!r.ok) failed++;
        console.log(`${r.ok ? "⚠" : "✗"} ${t}`);
        r.errors.forEach((e) => console.log(`   ERROR  ${e}`));
        r.warnings.forEach((w) => console.log(`   WARN   ${w}`));
      }
    }
    process.exit(failed ? 1 : 0);
  }

  case "render": {
    const targets = positional();
    if (!targets.length) { console.error("render needs a file"); process.exit(2); }
    const remote = bool("remote");
    for (const t of targets) {
      const abs = path.resolve(t);
      const v = validateDoc(abs);
      if (!v.ok) {
        console.error(`✗ ${t} failed validation:`);
        v.errors.forEach((e) => console.error("   " + e));
        process.exit(1);
      }

      if (remote) {
        // Render through the worker so output matches production exactly.
        const { RenderClient } = await import("../../core/src/client.mjs");
        const client = new RenderClient({
          url: flag("url"),
          key: flag("key"),
        });
        const stem = path.basename(abs, ".md");
        const outDir = flag("out") || path.join(path.dirname(abs), "build");
        fs.mkdirSync(outDir, { recursive: true });
        const outPdf = path.join(outDir, `${stem}.pdf`);
        const r = await client.renderDocument(abs, { filename: `${stem}.pdf` });
        fs.writeFileSync(outPdf, r.pdf);
        console.log(outPdf);
        continue;
      }

      const res = renderDocument(abs, {
        renderer: flag("renderer", "weasyprint"),
        outDir: flag("out"),
      });
      console.log(res.pdf);
    }
    break;
  }

  case "health": {
    const { RenderClient } = await import("../../core/src/client.mjs");
    const client = new RenderClient({ url: flag("url"), key: flag("key") });
    const h = await client.health();
    console.log(JSON.stringify(h.body, null, 2));
    process.exit(h.status === 200 ? 0 : 1);
  }

  default:
    console.log(HELP);
    process.exit(cmd ? 2 : 0);
}
