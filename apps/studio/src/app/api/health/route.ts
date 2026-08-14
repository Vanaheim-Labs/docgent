import { brands, storesFor } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Unauthenticated liveness probe.
 *
 * Reports whether Studio can reach both of its dependencies — the repo and
 * the render worker — without exposing document content.
 */
export async function GET() {
  const checks: Record<string, boolean> = {
    gh_token: !!process.env.DOCGENT_GH_TOKEN,
    auth_secret: !!process.env.AUTH_SECRET,
    render_url: !!process.env.DOCGENT_RENDER_URL,
    render_key: !!process.env.DOCGENT_API_KEY,
    repo_readable: false,
    worker_reachable: false,
  };

  // Every brand store must be reachable; one broken repo is degraded, not ok.
  const repos: Record<string, boolean> = {};
  await Promise.all(
    brands().map(async (b) => {
      try {
        const { git } = storesFor(b.id);
        await git.head();
        repos[b.repo] = true;
      } catch {
        repos[b.repo] = false;
      }
    })
  );
  const all = Object.values(repos);
  checks.repo_readable = all.length > 0 && all.every(Boolean);

  try {
    const url = process.env.DOCGENT_RENDER_URL;
    if (url) {
      const r = await fetch(`${url.replace(/\/$/, "")}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      checks.worker_reachable = r.ok;
    }
  } catch {}

  const ok = Object.values(checks).every(Boolean);
  return Response.json(
    { status: ok ? "ok" : "degraded", repos, checks },
    { status: ok ? 200 : 503 }
  );
}
