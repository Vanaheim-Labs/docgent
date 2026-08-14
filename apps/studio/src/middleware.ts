import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";

/**
 * Same host -> brand map as lib/store.ts (DOCGENT_HOST_BRANDS), duplicated
 * rather than imported: middleware runs on the Edge runtime, which cannot
 * load lib/store.ts's Node `fs` reads. This copy only ever needs the
 * hostname -> brand id mapping, not brand.yaml content, so it stays a plain
 * env parse with no filesystem dependency.
 */
function hostBrandMap(): Record<string, string> {
  return Object.fromEntries(
    (process.env.DOCGENT_HOST_BRANDS || "")
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => pair.split("=").map((s) => s.trim().toLowerCase()))
      .filter(([host, brand]) => host && brand)
  );
}

function brandForHost(host: string | null): string | null {
  if (!host) return null;
  const bare = host.toLowerCase().split(":")[0];
  return hostBrandMap()[bare] ?? null;
}

/**
 * Per-domain scoping, ahead of and in addition to the auth check.
 *
 * Each production domain is dedicated to one brand. Even a correctly
 * authenticated Inkl user must never be able to open
 * docs.inkl.com/northface/<slug> — the boundary is the domain, not just
 * who is logged in. A host with no brand mapping (local dev, the raw
 * Vercel URL) is unrestricted so development is not blocked by DNS setup.
 */
function guardBrandPath(req: NextRequest): NextResponse | null {
  // Prefer X-Forwarded-Host: requests arriving via the Cloudflare Worker proxy
  // (docs.inkl.com, docs.vanaheim.com.au, docs.northface.vc -> proxy.lobkit.com
  // -> this deployment) carry the original public hostname there, while the
  // Host header itself is rewritten to the stable Vercel deployment domain.
  // Falls back to Host for direct/local requests that bypass the proxy.
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const brand = brandForHost(host);
  if (!brand) return null; // unmapped host: no per-brand restriction

  const segments = req.nextUrl.pathname.split("/").filter(Boolean);
  const isBrandRoute =
    segments.length > 0 &&
    !["api", "signin", "_next", "favicon.ico"].includes(segments[0]);

  if (isBrandRoute && segments[0] !== brand) {
    return NextResponse.rewrite(new URL("/not-found", req.url));
  }

  // API routes are also brand-scoped: /api/doc/[brand]/... etc.
  if (segments[0] === "api" && segments.length > 2 && segments[2] !== brand) {
    // Skip auth's own routes (api/auth, api/health), which have no brand segment.
    if (!["auth", "health"].includes(segments[1])) {
      return NextResponse.rewrite(new URL("/not-found", req.url));
    }
  }

  return null;
}

export default auth((req) => {
  const guarded = guardBrandPath(req);
  if (guarded) return guarded;
  return NextResponse.next();
});

// Run on the Node.js runtime, not Edge: auth.ts (imported via the `auth`
// wrapper below) pulls in lib/store.ts, which reads brand.yaml from disk
// with node:fs. That only works where Node's fs module exists.
export const runtime = "nodejs";

export const config = {
  // Guard everything except auth endpoints, the sign-in page, the health
  // probe, and static assets.
  matcher: ["/((?!api/auth|api/health|signin|_next/static|_next/image|favicon.ico).*)"],
};
