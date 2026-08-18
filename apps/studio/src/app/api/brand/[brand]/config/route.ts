import { authorizeRequest } from "@/lib/agent-auth";
import { findBrand, getBrandYamlFromGit, writeBrandYamlToGit, agentAuthorForBrand } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Brand config (brand.yaml) read/write for agent tokens.
 *
 * GET  /api/brand/<brand>/config
 *   Returns the current brand.yaml source text plus its blob SHA.
 *   The SHA must be sent back on PUT to detect concurrent edits.
 *
 * PUT  /api/brand/<brand>/config
 *   Writes brand.yaml to the docgent-brands git repo as a signed commit.
 *   Body: { yaml: string, baseSha: string, message?: string }
 *   `baseSha` is mandatory — a blind write without it is rejected (409).
 *
 * Authentication: brand-scoped bearer token (DOCGENT_AGENT_TOKEN_<BRAND>)
 * or an active Studio session. Session auth is accepted so Studio's own
 * admin editor can use this same path; agents use the bearer token.
 */

export async function GET(
  req: Request,
  ctx: { params: Promise<{ brand: string }> }
) {
  const { brand } = await ctx.params;

  const authz = await authorizeRequest(req, brand);
  if (!authz.ok) return new Response("unauthorised", { status: 401 });

  const brandRecord = findBrand(brand);
  if (!brandRecord) {
    return Response.json({ error: `unknown brand: ${brand}` }, { status: 404 });
  }

  try {
    const { content, sha } = await getBrandYamlFromGit(brand);
    return Response.json({ brand, yaml: content, sha });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 404 });
  }
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ brand: string }> }
) {
  const { brand } = await ctx.params;

  const authz = await authorizeRequest(req, brand);
  if (!authz.ok) return new Response("unauthorised", { status: 401 });

  const brandRecord = findBrand(brand);
  if (!brandRecord) {
    return Response.json({ error: `unknown brand: ${brand}` }, { status: 404 });
  }

  let body: { yaml?: string; baseSha?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const { yaml, baseSha, message } = body;

  if (typeof yaml !== "string" || !yaml.trim()) {
    return Response.json({ error: "'yaml' is required" }, { status: 400 });
  }
  if (typeof baseSha !== "string" || !baseSha.trim()) {
    return Response.json(
      {
        error: "'baseSha' is required — read the current config first (GET /api/brand/<brand>/config) and include its sha",
        hint: "A blind write without baseSha is rejected to prevent clobbering concurrent edits.",
      },
      { status: 400 }
    );
  }

  const author =
    authz.via === "agent-token" ? agentAuthorForBrand(brand) : authz.author;

  try {
    const result = await writeBrandYamlToGit(brand, yaml, baseSha, author, message);
    return Response.json({
      changed: result.changed,
      sha: result.sha,
      commit: result.commit,
    });
  } catch (e) {
    const err = e as { name?: string; status?: number; message?: string; expected?: string; actual?: string };
    if (err.name === "StaleWriteError") {
      return Response.json(
        {
          error: "stale",
          message: err.message,
          expected: err.expected,
          actual: err.actual,
          hint: "Re-read the config (GET /api/brand/<brand>/config), apply your changes to the new yaml, and retry with the updated sha.",
        },
        { status: 409 }
      );
    }
    return Response.json({ error: err.message || String(e) }, { status: 500 });
  }
}
