import { auth } from "@/auth";
import { agentTokenValidForBrand, agentAuthorForBrand } from "@/lib/store";

export type Authorization =
  | { ok: true; via: "session"; author: { name: string; email: string } }
  | { ok: true; via: "agent-token"; author: { name: string; email: string } }
  | { ok: false };

/** Explicit credentials never inherit human authority from an ambient cookie. */
export async function authorizeRequest(req: Request, brand: string): Promise<Authorization> {
  const header = req.headers.get("authorization");
  if (header !== null) {
    const token = header.match(/^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i)?.[1];
    if (token && agentTokenValidForBrand(token, brand)) {
      return { ok: true, via: "agent-token", author: agentAuthorForBrand(brand) };
    }
    return { ok: false };
  }
  const session = await auth().catch(() => null);
  const allowed = (session?.user as { allowedBrands?: string[] } | undefined)?.allowedBrands;
  if (!session?.user?.email || !allowed?.includes(brand)) return { ok: false };
  return { ok: true, via: "session", author: {
    name: session.user.name || "Docgent Studio",
    email: session.user.email,
  } };
}
