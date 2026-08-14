#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDocument, ROOT, loadBrand, brandRepo, brandRepoMap } from "../../core/src/render.mjs";
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

const HELP = `docgent — multi-brand document production

  docgent new --brand <id> --type <doctype> --title "..." [--slug <slug>]
  docgent validate <file.md> [...]
  docgent render <file.md> [--renderer weasyprint|chrome] [--out <dir>]
  docgent render <file.md> --remote [--url <worker>] [--key <secret>]
  docgent health [--url <worker>] [--key <secret>]
  docgent brands
  docgent docs

Bulk production (Phase 7 — for agents):
  docgent doctypes --brand <id>
  docgent batch --brand <id> --type <doctype> --records <file.json|csv>
                 [--concurrency N] [--dry-run] [--no-render] [--json]

Git-backed (reads the repo through the GitHub API, as Studio will):
  docgent remote-docs [--brand <id>]
  docgent timeline <brand>/<slug> [--limit N]
  docgent git-check

Remote rendering uses the render worker (see apps/render-worker), so output
matches production regardless of what is installed locally.
Env: DOCGENT_RENDER_URL, DOCGENT_API_KEY
Git:  DOCGENT_GH_TOKEN (or GITHUB_TOKEN)
      Repo is resolved per brand from brand.yaml 'repo'; --repo or
      DOCGENT_REPO override it.
`;

/** Emits a machine-readable result when --json is set, human text otherwise. */
function report(payload, humanFn) {
  if (bool("json")) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    humanFn();
  }
}

/**
 * Builds git + document stores for a brand.
 *
 * The repo is resolved from the brand, so commands that touch git must say
 * which brand they mean. Falls back to the gh CLI's token for local use.
 */
/**
 * Resolves the GitHub token for a brand's document store.
 *
 * Precedence: brand-specific env > ~/.docgent/tokens.env > generic env > gh CLI.
 *
 * Per-brand tokens matter here: each is a fine-grained PAT scoped to exactly
 * one document repo, so a leaked token cannot reach another brand's documents.
 * The gh CLI fallback is deliberately last — it carries broad personal scope
 * and is fine for interactive engineering, not for agent-driven writes.
 */
async function resolveToken(brandId) {
  const key = brandId ? `DOCGENT_GH_TOKEN_${brandId.toUpperCase()}` : null;
  if (key && process.env[key]) return process.env[key];

  // Token file, kept outside the repo with 0600 perms.
  if (key) {
    try {
      const os = await import("node:os");
      const file = path.join(os.homedir(), ".docgent", "tokens.env");
      if (fs.existsSync(file)) {
        for (const line of fs.readFileSync(file, "utf8").split("\n")) {
          const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
          if (m && m[1] === key) return m[2];
        }
      }
    } catch {}
  }

  if (process.env.DOCGENT_GH_TOKEN) return process.env.DOCGENT_GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  try {
    const { execFileSync } = await import("node:child_process");
    const t = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
    if (t) {
      console.error(
        `warning: using the gh CLI token for '${brandId || "?"}'. That credential is broadly scoped; ` +
        `set ${key || "DOCGENT_GH_TOKEN_<BRAND>"} for agent use.`
      );
      return t;
    }
  } catch {}

  console.error(
    `No GitHub token for brand '${brandId || "?"}'. Set ${key || "DOCGENT_GH_TOKEN_<BRAND>"}, ` +
    `add it to ~/.docgent/tokens.env, or run 'gh auth login'.`
  );
  process.exit(2);
}

async function makeStores(brandId) {
  const { GitStore } = await import("../../git-store/src/index.mjs");
  const { DocumentStore } = await import("../../git-store/src/documents.mjs");

  const token = await resolveToken(brandId);

  // Repo follows the brand: North Face documents belong in the North Face org,
  // not wherever DOCGENT_REPO happened to point.
  const slug = brandRepo(brandId, { override: flag("repo") });
  const [owner, repo] = slug.split("/");
  const git = new GitStore({ owner, repo, token, branch: process.env.DOCGENT_BRANCH || "main" });
  return { git, docs: new DocumentStore(git), repo: slug };
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
        console.log(`${b.padEnd(14)} ${(brand.name || "").padEnd(24)} ${brandRepo(b)}`);
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

  case "doctypes": {
    const { listDoctypes } = await import("../../core/src/batch.mjs");
    const brand = flag("brand");
    if (!brand) { console.error("--brand required"); process.exit(2); }
    loadBrand(brand);
    const types = listDoctypes(brand);
    report({ brand, doctypes: types }, () => {
      if (!types.length) {
        console.log(`${brand} has no doctype templates (brands/${brand}/doctypes/)`);
      } else {
        types.forEach((t) => console.log(t));
      }
    });
    break;
  }

  case "batch": {
    // Bulk production: one doctype + N records -> N validated documents.
    // This is the path agents use; keep its output machine-readable via --json.
    const { produceBatch, loadRecords } = await import("../../core/src/batch.mjs");

    const brand = flag("brand");
    const doctype = flag("type");
    const recordsFile = flag("records");
    if (!brand || !doctype || !recordsFile) {
      console.error("usage: docgent batch --brand <id> --type <doctype> --records <file>");
      process.exit(2);
    }
    loadBrand(brand);

    let records;
    try {
      records = loadRecords(recordsFile);
    } catch (e) {
      console.error(`Could not read records: ${e.message}`);
      process.exit(2);
    }

    const dryRun = bool("dry-run");
    const wantRender = !bool("no-render") && !dryRun;
    const quiet = bool("json");

    // Render through the worker when configured, else locally. Either way the
    // output is identical — that is the point of the Renderer interface.
    let renderFn = null;
    if (wantRender) {
      if (process.env.DOCGENT_RENDER_URL && !bool("local")) {
        const { RenderClient } = await import("../../core/src/client.mjs");
        const client = new RenderClient({ url: flag("url"), key: flag("key") });
        renderFn = async (abs) => {
          const stem = path.basename(abs, ".md");
          const outDir = path.join(path.dirname(abs), "build");
          fs.mkdirSync(outDir, { recursive: true });
          const r = await client.renderDocument(abs, { filename: `${stem}.pdf` });
          const outPdf = path.join(outDir, `${stem}.pdf`);
          fs.writeFileSync(outPdf, r.pdf);
          return { pdf: outPdf, renderMs: r.renderMs };
        };
      } else {
        renderFn = async (abs) => {
          const res = renderDocument(abs, { renderer: flag("renderer", "weasyprint") });
          return { pdf: res.pdf, renderMs: null };
        };
      }
    }

    const started = Date.now();
    const summary = await produceBatch({
      brand,
      doctype,
      records,
      validate: (abs) => validateDoc(abs),
      render: renderFn,
      concurrency: Number(flag("concurrency", 4)),
      dryRun,
      onProgress: quiet
        ? undefined
        : ({ index, total, slug, phase, ok }) => {
            if (phase === "done" || ok === false) {
              const mark = ok === false ? "✗" : "✓";
              console.log(`${mark} [${index + 1}/${total}] ${slug}`);
            }
          },
    });

    const tookMs = Date.now() - started;

    report({ ...summary, brand, doctype, dryRun, tookMs }, () => {
      console.log("");
      console.log(`${summary.succeeded}/${summary.total} produced in ${(tookMs / 1000).toFixed(1)}s${dryRun ? " (dry run)" : ""}`);
      for (const f of summary.failures) {
        console.log(`\n✗ ${f.slug} (failed at ${f.phase})`);
        (f.errors || []).forEach((e) => console.log(`    ${e}`));
      }
    });

    process.exit(summary.failed ? 1 : 0);
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
    const { git, docs, repo } = await makeStores(flag("brand"));
    console.log(`repo ${repo}`);
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
      console.error("usage: docgent timeline <brand>/<slug>");
      process.exit(2);
    }
    const [brand, slug] = target.split("/");
    const { docs } = await makeStores(brand);
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
    const { git, docs, repo } = await makeStores(flag("brand"));
    console.log(`repo ${repo}`);
    const { StaleWriteError } = await import("../../git-store/src/index.mjs");
    const branch = `docgent-check-${Date.now().toString(36)}`;
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

      const testPath = "documents/.docgent-check.md";
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
          { path: "documents/.docgent-check-a.md", content: "a\n" },
          { path: "documents/.docgent-check-b.md", content: "b\n" },
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
