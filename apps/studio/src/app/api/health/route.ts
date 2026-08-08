import { stores, repoSlug } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Unauthenticated liveness probe.
 *
 * Reports whether Studio can reach both of its dependencies — the repo and
 * the render worker — without exposing document content.
 */
export async function GET() {
  const checks: Record<string, boolean> = {
    gh_token: !!process.env.DOCFORGE_GH_TOKEN,
    auth_secret: !!process.env.AUTH_SECRET,
    render_url: !!process.env.DOCFORGE_RENDER_URL,
    render_key: !!process.env.DOCFORGE_API_KEY,
    repo_readable: false,
    worker_reachable: false,
  };

  try {
    const { git } = stores();
    await git.head();
    checks.repo_readable = true;
  } catch {}

  try {
    const url = process.env.DOCFORGE_RENDER_URL;
    if (url) {
      const r = await fetch(`${url.replace(/\/$/, "")}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      checks.worker_reachable = r.ok;
    }
  } catch {}

  const ok = Object.values(checks).every(Boolean);
  return Response.json(
    { status: ok ? "ok" : "degraded", repo: repoSlug(), checks },
    { status: ok ? 200 : 503 }
  );
}
