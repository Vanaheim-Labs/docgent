import { auth } from "@/auth";
import { agentTokenValidForBrand, agentAuthorForBrand } from "@/lib/store";

export type Authorization =
  | { ok: true; via: "session"; author: { name: string; email: string } }
  | { ok: true; via: "agent-token"; author: { name: string; email: string } }
  | { ok: false };

/**
 * Single authorization path shared by every brand-scoped API route.
 *
 * Two ways in, checked in order:
 *   1. A signed-in Studio session (human, via Google OAuth) — unchanged from
 *      before. The commit author is the person's name/email.
 *   2. A bearer token scoped to this specific brand — for OpenClaw agents
 *      calling the API directly (see the docgent-doc-access skill). The
 *      commit author is a fixed per-brand agent identity
 *      (agentAuthorForBrand), so "who touched this" in the timeline
 *      distinguishes an agent-authored change from a human one, the same
 *      way it already distinguishes an accepted AI rewrite via the
 *      "Generated-by: Docgent Studio" commit trailer.
 *
 * A request with neither is rejected. A request with a bearer token for the
 * wrong brand (or no token configured for that brand at all) is also
 * rejected — agentTokenValidForBrand fails closed, it does not fall back to
 * checking other brands' tokens.
 */
export async function authorizeRequest(req: Request, brand: string): Promise<Authorization> {
  const session = await auth();
  if (session?.user) {
    const author = {
      name: session.user.name || (session.user as { login?: string }).login || "Docgent Studio",
      email: session.user.email || "studio@docgent.local",
    };
    return { ok: true, via: "session", author };
  }

  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match) {
    const token = match[1].trim();
    if (token && agentTokenValidForBrand(token, brand)) {
      return { ok: true, via: "agent-token", author: agentAuthorForBrand(brand) };
    }
  }

  return { ok: false };
}
