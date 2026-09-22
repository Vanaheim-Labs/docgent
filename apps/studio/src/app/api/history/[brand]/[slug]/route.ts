import { storesFor } from "@/lib/store";
import { authorizeRequest } from "@/lib/agent-auth";
import { docPath } from "../../../../../../../../packages/git-store/src/documents.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Version history for a single document.
 *
 * Returns commits in reverse-chronological order (newest first), which is the
 * natural order from the GitHub commits API and the most useful order for
 * agents: the first entry is always the current revision.
 *
 * The `version` field for each commit is the `version:` frontmatter value
 * from the document at that exact revision, resolved in parallel. This lets
 * agents cite "v0.4" rather than a raw SHA in output to humans. Resolution is
 * best-effort: a blob that fails to read yields `version: null` and does not
 * fail the whole request.
 *
 * Pagination follows the GitHub commits API: `limit` maps to `per_page` and
 * `page` (1-based) maps to `page`. `count` in the response is the number of
 * entries actually returned. Callers detect the last page when `count < limit`.
 *
 * Primary use case: agent discovers which past commit held a dropped chart,
 * reads that commit via GET /api/doc/[brand]/[slug]?ref=<sha>, and restores
 * it via POST /api/restore/[brand]/[slug].
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ brand: string; slug: string }> }
) {
  const { brand, slug } = await ctx.params;

  const authz = await authorizeRequest(req, brand);
  if (!authz.ok) return new Response("unauthorised", { status: 401 });

  const url = new URL(req.url);

  // Parse and clamp limit (1–100, default 20).
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit !== null
    ? Math.trunc(Number(rawLimit))
    : 20;
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    return Response.json({ error: "limit must be 1–100" }, { status: 400 });
  }

  // Parse page (≥ 1, default 1).
  const rawPage = url.searchParams.get("page");
  const page = rawPage !== null
    ? Math.trunc(Number(rawPage))
    : 1;
  if (!Number.isFinite(page) || page < 1) {
    return Response.json({ error: "page must be ≥ 1" }, { status: 400 });
  }

  try {
    const { git, docs } = await storesFor(brand);

    // Build the path in the brand's documents repo. Uses the same docPath()
    // function as DocumentStore so the path is always in sync.
    const path = docPath(brand, slug);

    // Call the GitHub commits API directly so we can pass `page`.
    // GitStore.history() is the right home for this, but it doesn't expose
    // pagination yet — driving it from here avoids patching the package.
    const params = new URLSearchParams({
      path,
      sha: git.branch,
      per_page: String(limit),
      page: String(page),
    });

    const ghUrl = `https://api.github.com/repos/${git.owner}/${git.repo}/commits?${params}`;
    const ghRes = await fetch(ghUrl, {
      headers: {
        Authorization: `Bearer ${git.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (ghRes.status === 404) {
      return Response.json(
        { error: `document not found: ${brand}/${slug}` },
        { status: 404 }
      );
    }
    if (!ghRes.ok) {
      let detail = `${ghRes.status} ${ghRes.statusText}`;
      try {
        const j = await ghRes.json();
        if (j?.message) detail = `${ghRes.status}: ${j.message}`;
      } catch {}
      return Response.json({ error: `GitHub API error — ${detail}` }, { status: 502 });
    }

    const raw: GitHubCommit[] = await ghRes.json();

    // Resolve frontmatter version for each commit in parallel.
    // readAt() fetches the blob content at that exact SHA. A failed read
    // yields null rather than aborting — one slow or missing blob should not
    // block the whole listing.
    const commits = await Promise.all(
      raw.map(async (c): Promise<CommitEntry> => {
        let version: string | null = null;
        try {
          const doc = await docs.readAt(brand, slug, c.sha);
          version = (doc.frontmatter?.version as string | undefined) ?? null;
        } catch {
          // Best-effort — leave version as null
        }

        return {
          sha: c.sha,
          shortSha: c.sha.slice(0, 7),
          date: c.commit.author?.date ?? null,
          author: c.commit.author?.name ?? "unknown",
          message: c.commit.message,
          subject: c.commit.message.split("\n")[0],
          version,
        };
      })
    );

    return Response.json({
      brand,
      slug,
      count: commits.length,
      commits,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/* ------------------------------------------------------------------ *
 * Local types — mirrors the GitHub commits API response shape.
 * Using inline types keeps the route self-contained (no SDK dep).
 * ------------------------------------------------------------------ */

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author?: { name?: string; email?: string; date?: string };
  };
}

interface CommitEntry {
  sha: string;
  shortSha: string;
  date: string | null;
  author: string;
  message: string;
  subject: string;
  version: string | null;
}
