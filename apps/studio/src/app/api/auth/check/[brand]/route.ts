import { authorizeRequest } from "@/lib/agent-auth";
import { findBrand, storesFor } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** Read-only connection diagnostics. Never echo credentials or upstream errors. */
export async function GET(req: Request, ctx: { params: Promise<{ brand: string }> }) {
  const { brand } = await ctx.params;
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const authz = await authorizeRequest(req, brand);
  if (!authz.ok) {
    const supplied = req.headers.has("authorization") || req.headers.has("cookie");
    return reply({ valid: false, brand, code: supplied ? "credential_rejected" : "credential_required",
      hint: supplied ? "Check the brand in the URL and its assigned token, or sign out and sign in again. Do not paste credentials into support messages."
        : "Sign in to Studio or send Authorization: Bearer <brand token>." }, 401);
  }
  const record = findBrand(brand);
  if (!record) return reply({ valid: false, brand, code: "brand_unavailable", hint: "Ask the operator to verify the brand configuration." }, 404);

  let repository: { ok: boolean; code: string; hint?: string };
  try {
    const { git } = await storesFor(brand);
    await git.head();
    repository = { ok: true, code: "repository_readable" };
  } catch (error) {
    const status = (error as { status?: number }).status;
    const code = status === 429 ? "repository_rate_limited" : [401, 403, 404].includes(status || 0) ? "repository_access_failed" : "repository_unavailable";
    repository = { ok: false, code, hint: status === 429 ? "Wait before retrying; ask the operator to check GitHub rate limits."
      : "Ask the operator to check the configured repository, branch and GitHub service credential. Your Docgent token is valid." };
  }
  const renderer = { ok: Boolean(process.env.DOCGENT_RENDER_URL && process.env.DOCGENT_API_KEY), verified: false,
    hint: "Configuration check only. Open a draft PDF to test the renderer; this probe does not render or call a model." };
  const releaseArchive = { ok: false, verified: false, code: "deferred",
    hint: "Durable release archiving is not implemented in this build. Release changes lifecycle status only; PDFs remain regenerable previews." };
  return reply({ valid: true, brand, brandName: record.name, via: authz.via,
    ready: repository.ok && renderer.ok, readinessScope: "repository read and renderer configuration; not release readiness",
    capabilities: { editDraft: true, approve: authz.via === "session", release: authz.via === "session", archiveRelease: false },
    checks: { repository, renderer, releaseArchive } });
}
