/**
 * Bridge to the Phase 3 git-store.
 *
 * The package is plain ESM in the monorepo. Studio imports it directly rather
 * than duplicating logic, so Studio and the CLI cannot drift apart on what a
 * document or a version means.
 */
// Untyped ESM package in the monorepo; allowJs resolves it without types.
import { GitStore } from "../../../../packages/git-store/src/index.mjs";
import { DocumentStore } from "../../../../packages/git-store/src/documents.mjs";

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

let cached: { git: any; docs: any } | null = null;

export function stores() {
  if (cached) return cached;

  const token = process.env.DOCFORGE_GH_TOKEN;
  if (!token) throw new Error("DOCFORGE_GH_TOKEN is not set");

  const slug = process.env.DOCFORGE_REPO || "Vanaheim-Labs/docforge";
  const [owner, repo] = slug.split("/");
  const branch = process.env.DOCFORGE_BRANCH || "main";

  const git = new GitStore({ owner, repo, token, branch });
  cached = { git, docs: new DocumentStore(git) };
  return cached;
}

export function repoSlug() {
  return process.env.DOCFORGE_REPO || "Vanaheim-Labs/docforge";
}
