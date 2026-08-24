#!/usr/bin/env node
/**
 * clone-brands.mjs — prebuild script
 *
 * Clones (or updates) the docgent-brands repo into the monorepo-root brands/
 * directory so that Next.js outputFileTracingIncludes can bake brand.yaml
 * files into the Vercel serverless bundle.
 *
 * Required env var: DOCGENT_BRANDS_TOKEN (GitHub PAT with repo read access)
 * Optional env var: DOCGENT_BRANDS_REPO  (default: Vanaheim-Labs/docgent-brands)
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// brands/ lives at the monorepo root, two levels up from apps/studio/scripts/
const brandsDir = resolve(__dirname, "..", "..", "..", "brands");
const repo = process.env.DOCGENT_BRANDS_REPO ?? "Vanaheim-Labs/docgent-brands";
const token = process.env.DOCGENT_BRANDS_TOKEN;

if (!token) {
  console.error("[clone-brands] DOCGENT_BRANDS_TOKEN is not set — brands/ will be empty");
  process.exit(1);
}

const url = `https://x-access-token:${token}@github.com/${repo}.git`;

try {
  if (existsSync(`${brandsDir}/.git`)) {
    console.log("[clone-brands] brands/ exists with .git — pulling latest...");
    execSync(`git -C "${brandsDir}" pull --ff-only`, { stdio: "inherit" });
  } else if (existsSync(brandsDir)) {
    // Directory exists but no .git — Vercel checked out the submodule as a
    // plain directory. Pull the real repo on top by cloning into a temp dir
    // then copying the .git folder in, or simply use git init + fetch.
    console.log("[clone-brands] brands/ exists without .git (submodule checkout) — initialising git and fetching...");
    execSync(`git -C "${brandsDir}" init`, { stdio: "inherit" });
    execSync(`git -C "${brandsDir}" remote add origin "${url}"`, { stdio: "inherit" });
    execSync(`git -C "${brandsDir}" fetch --depth 1 origin HEAD`, { stdio: "inherit" });
    execSync(`git -C "${brandsDir}" checkout FETCH_HEAD`, { stdio: "inherit" });
  } else {
    console.log(`[clone-brands] Cloning ${repo} → brands/`);
    execSync(`git clone --depth 1 "${url}" "${brandsDir}"`, { stdio: "inherit" });
  }
  console.log("[clone-brands] Done.");
} catch (err) {
  console.error("[clone-brands] Failed to clone/update brands repo:", err.message);
  process.exit(1);
}
