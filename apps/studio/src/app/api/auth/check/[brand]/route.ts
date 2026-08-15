import { authorizeRequest } from "@/lib/agent-auth";
import { findBrand } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * Explicit auth/introspection endpoint.
 *
 * Before this existed, the documented way for an agent to verify a bearer
 * token was to request a slug that doesn't exist and treat 404 as success
 * (auth passed, the probe slug just isn't real) — clever but non-obvious,
 * and indistinguishable from "the route itself is broken" without reading
 * the skill's fine print. This route answers the question directly instead.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ brand: string }> }
) {
  const { brand } = await ctx.params;

  const brandRecord = findBrand(brand);
  const authz = await authorizeRequest(req, brand);

  if (!authz.ok) {
    // Distinguish "no credential supplied at all" from "credential supplied
    // but wrong/expired" isn't possible from authorizeRequest's boolean
    // today, so both currently return 401 — that's still strictly better
    // than the 404-probe pattern, and leaves room to split later without
    // changing the response shape.
    return Response.json(
      { valid: false, brand, reason: "invalid or missing credential" },
      { status: 401 }
    );
  }

  if (!brandRecord) {
    return Response.json(
      { valid: false, brand, reason: "unknown brand" },
      { status: 404 }
    );
  }

  return Response.json({
    valid: true,
    brand,
    brandName: brandRecord.name,
    via: authz.via,
  });
}
