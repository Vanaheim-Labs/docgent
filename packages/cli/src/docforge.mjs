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

Git-backed (reads the repo through the GitHub API, as Studio will):
  docforge remote-docs [--brand <id>]
  docforge timeline <brand>/<slug> [--limit N]
  docforge git-check

Remote rendering uses the render worker (see apps/render-worker), so output
matches production regardless of what is installed locally.
Env: DOCFORGE_RENDER_URL, DOCFORGE_API_KEY
Git:  DOCFORGE_GH_TOKEN (or GITHUB_TOKEN), DOCFORGE_REPO=owner/repo
`;

/**
 * Builds git + document stores from the environment.
 * Falls back to the gh CLI's token so local use needs no extra setup.
 */
async function makeStores() {
  const { GitStore } = await import("../../git-store/src/index.mjs");
  const { DocumentStore } = await import("../../git-store/src/documents.mjs");

  let token = process.env.DOCFORGE_GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    try {
      const { execFileSync } = await import("node:child_process");
      token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
    } catch {}
  }
  if (!token) {
    console.error("No GitHub token. Set DOCFORGE_GH_TOKEN or run 'gh auth login'.");
    process.exit(2);
  }

  const slug = process.env.DOCFORGE_REPO || "Vanaheim-Labs/docforge";
  const [owner, repo] = slug.split("/");
  const git = new GitStore({ owner, repo, token, branch: process.env.DOCFORGE_BRANCH || "main" });
  return { git, docs: new DocumentStore(git) };
}

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

  // ---- git-backed commands (Phase 3) -------------------------------------
  // These read the repo through the GitHub API rather than the working tree,
  // which is what Studio will do. Verifying them here keeps the CLI and the
  // web UI honest about sharing one source of truth.

  case "remote-docs": {
    const { git, docs } = await makeStores();
    const { documents, treeSha } = await docs.listDocuments({ brand: flag("brand") });
    console.log(`tree ${treeSha.slice(0, 7)} — ${documents.length} document(s)`);
    for (const d of documents) {
      const assets = d.assets.length ? `  (${d.assets.length} asset${d.assets.length > 1 ? "s" : ""})` : "";
      console.log(`  ${d.brand}/${d.slug}${assets}`);
    }
    break;
  }

  case "timeline": {
    const target = positional()[0];
    if (!target || !target.includes("/")) {
      console.error("usage: docforge timeline <brand>/<slug>");
      process.exit(2);
    }
    const [brand, slug] = target.split("/");
    const { docs } = await makeStores();
    const tl = await docs.timeline(brand, slug, { limit: Number(flag("limit", 20)) });
    if (!tl.length) {
      console.log("no history (is the document committed?)");
      break;
    }
    for (const v of tl) {
      const marker = v.isCurrent ? "*" : " ";
      const when = (v.author.date || "").slice(0, 10);
      console.log(`${marker} v${String(v.version).padStart(3)}  ${v.shortSha}  ${when}  ${v.author.name || "?"}`);
      console.log(`         ${v.subject}`);
    }
    break;
  }

  case "git-check": {
    // Live integration check against a scratch branch. Proves optimistic
    // concurrency works against real GitHub, not just the stubbed tests.
    const { git, docs } = await makeStores();
    const { StaleWriteError } = await import("../../git-store/src/index.mjs");
    const branch = `docforge-check-${Date.now().toString(36)}`;
    const results = [];
    const ok = (name, pass, detail = "") => {
      results.push({ name, pass, detail });
      console.log(`${pass ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
    };

    try {
      const head = await git.head();
      ok("read HEAD", !!head, head.slice(0, 7));

      const brands = await docs.listBrands();
      ok("list brands", brands.length > 0, brands.join(", "));

      const { documents } = await docs.listDocuments();
      ok("list documents", documents.length > 0, `${documents.length} found`);

      await git.createBranch(branch);
      ok("create scratch branch", true, branch);

      const scratch = new (await import("../../git-store/src/index.mjs")).GitStore({
        owner: git.owner, repo: git.repo, token: git.token, branch,
      });

      const testPath = "documents/.docforge-check.md";
      const created = await scratch.writeFile(testPath, "v1\n", {
        message: "test: git-store integration check",
      });
      ok("create file", created.changed, created.sha.slice(0, 7));

      const noop = await scratch.writeFile(testPath, "v1\n", {
        message: "test: should be a no-op",
        sha: created.sha,
      });
      ok("identical content is a no-op", noop.changed === false);

      let stale = false;
      try {
        await scratch.writeFile(testPath, "v2\n", {
          message: "test: stale write",
          sha: "0000000000000000000000000000000000000000",
        });
      } catch (e) {
        stale = e instanceof StaleWriteError;
      }
      ok("stale write rejected", stale);

      const updated = await scratch.writeFile(testPath, "v2\n", {
        message: "test: valid update",
        sha: created.sha,
      });
      ok("valid update commits", updated.changed);

      const atomic = await scratch.commitFiles(
        [
          { path: "documents/.docforge-check-a.md", content: "a\n" },
          { path: "documents/.docforge-check-b.md", content: "b\n" },
        ],
        { message: "test: atomic multi-file commit" }
      );
      ok("atomic multi-file commit", atomic.files.length === 2, atomic.commit.sha.slice(0, 7));

      const hist = await scratch.history(testPath, { limit: 10 });
      ok("history returns commits", hist.length >= 2, `${hist.length} commits`);

      const past = await scratch.readFileAt(testPath, hist[hist.length - 1].sha);
      ok("read file at past commit", past.content === "v1\n", JSON.stringify(past.content));

      const d = await scratch.diff(hist[hist.length - 1].sha, hist[0].sha, { path: testPath });
      ok("diff between commits", d.files.length === 1, `+${d.files[0]?.additions} -${d.files[0]?.deletions}`);
    } catch (e) {
      ok("unexpected failure", false, e.message);
    } finally {
      try {
        await git["_GitStore__request"]?.call(git, `/git/refs/heads/${branch}`, { method: "DELETE" });
      } catch {}
      // Private method is not reachable; delete via a fresh fetch instead.
      try {
        await fetch(`https://api.github.com/repos/${git.owner}/${git.repo}/git/refs/heads/${branch}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${git.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        console.log(`  (cleaned up ${branch})`);
      } catch {}
    }

    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  }

  default:
    console.log(HELP);
    process.exit(cmd ? 2 : 0);
}
