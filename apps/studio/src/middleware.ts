import { NextResponse, NextRequest, type NextFetchEvent } from "next/server";
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
  const host = req.headers.get("host");
  const brand = brandForHost(host);
  if (!brand) return null; // unmapped host: no per-brand restriction

  const segments = req.nextUrl.pathname.split("/").filter(Boolean);
  // Top-level static files served straight out of public/ (docgent-logo.svg,
  // favicon.ico, etc.) have no brand segment to check — they are assets of
  // the app shell, not brand content, so a dotted first segment is never a
  // brand route regardless of which file it is.
  const isStaticFile = segments.length > 0 && segments[0].includes(".");
  const isBrandRoute =
    segments.length > 0 &&
    !isStaticFile &&
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

/**
 * Requests to every brand domain (docs.docgent.io, inkl.docgent.io,
 * vanaheim.docgent.io, northface.docgent.io) arrive via a Cloudflare Worker
 * proxy (proxy.lobkit.com), not direct Vercel domain attachment. The Worker
 * rewrites Host to the stable Vercel deployment domain and forwards the
 * real public hostname in X-Forwarded-Host instead.
 *
 * auth()'s trustHost option only tells NextAuth to trust *the Host header it
 * receives* — it does not know to prefer X-Forwarded-Host. Left uncorrected,
 * every OAuth callback URL, session cookie and CSRF check auth() builds
 * targets the proxy's stable domain rather than the domain the visitor is
 * actually on, so sign-in and sign-out silently fail on every proxied
 * domain. Rebuilding the request with Host corrected before auth() ever
 * sees it fixes that at the source; everything downstream (guardBrandPath,
 * auth() itself, route handlers) then agrees on one real hostname.
 *
 * Falls back to the existing request unchanged for direct/local traffic
 * that bypasses the proxy (dev, the raw Vercel URL) — there is no
 * X-Forwarded-Host to correct against there.
 */
function withPublicHost(req: NextRequest): NextRequest {
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (!forwardedHost || forwardedHost === req.headers.get("host")) return req;

  const headers = new Headers(req.headers);
  headers.set("host", forwardedHost);

  const forwardedProto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  const url = new URL(req.nextUrl.pathname + req.nextUrl.search, `${forwardedProto}://${forwardedHost}`);

  return new NextRequest(url, {
    headers,
    method: req.method,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    duplex: req.method === "GET" || req.method === "HEAD" ? undefined : "half",
  });
}

type AuthMiddlewareFn = (request: NextRequest, event: NextFetchEvent) => ReturnType<typeof NextResponse.next> | Promise<Response>;

const authMiddleware = auth((req) => {
  const guarded = guardBrandPath(req);
  if (guarded) return guarded;
  return NextResponse.next();
}) as unknown as AuthMiddlewareFn;

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  return authMiddleware(withPublicHost(req), event);
}

// Run on the Node.js runtime, not Edge: auth.ts (imported via the `auth`
// wrapper above) pulls in lib/store.ts, which reads brand.yaml from disk
// with node:fs. That only works where Node's fs module exists.
export const runtime = "nodejs";

export const config = {
  // Guard everything except auth endpoints, the sign-in page, the health
  // probe, and static assets.
  matcher: ["/((?!api/auth|api/health|signin|_next/static|_next/image|favicon.ico).*)"],
};
