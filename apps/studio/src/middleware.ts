import { NextResponse, NextRequest, type NextFetchEvent } from "next/server";
import { auth } from "@/auth";

/**
 * Per-brand scoping, ahead of and in addition to the auth check.
 *
 * Docgent is served from one domain with the brand in the path
 * (docs.docgent.io/<brand>/<slug>) rather than one domain per brand, so
 * there is no host->brand lookup here any more — the brand a request names
 * is just the first path segment. What still needs enforcing per request is
 * that the signed-in user is actually allowed into *that* brand: sign-in
 * only proves membership in at least one brand (see auth.ts), not every
 * brand, so a correctly authenticated Inkl user must still be refused
 * /northface/<slug>.
 *
 * The session's allowed-brand list is written into the JWT at sign-in
 * (auth.ts's jwt callback) precisely so this check can run here, on the
 * Edge runtime, without re-reading brand.yaml off disk on every request.
 */
function guardBrandPath(req: NextRequest, allowedBrands: string[] | null): NextResponse | null {
  const segments = req.nextUrl.pathname.split("/").filter(Boolean);
  // Top-level static files served straight out of public/ (docgent-logo.svg,
  // favicon.ico, etc.) have no brand segment to check — they are assets of
  // the app shell, not brand content, so a dotted first segment is never a
  // brand route regardless of which file it is.
  const isStaticFile = segments.length > 0 && segments[0].includes(".");
  const isBrandRoute =
    segments.length > 0 &&
    !isStaticFile &&
    !["api", "admin", "signin", "_next", "favicon.ico"].includes(segments[0]);

  const brandSegment = isBrandRoute
    ? segments[0]
    : segments[0] === "api" && segments.length > 2 && !["auth", "health"].includes(segments[1])
      ? segments[2]
      : null;

  if (!brandSegment) return null; // not a brand-scoped route

  // No session yet, or a session predating this check (allowedBrands null):
  // let the request through to auth()'s own gate / the route handler, which
  // still requires a session. This guard only narrows *which* brand a
  // signed-in user reaches, it is not itself the sign-in check.
  if (!allowedBrands) return null;

  if (!allowedBrands.includes(brandSegment)) {
    return NextResponse.rewrite(new URL("/not-found", req.url));
  }

  return null;
}

/**
 * /admin is a separate concern from per-brand access entirely: it is not
 * about viewing/editing any one brand's documents, it is about managing
 * brand *configuration* across all brands, so it is deliberately not
 * folded into guardBrandPath's allowedBrands check above. A user can be in
 * every brand's access list and still not be an admin, and vice versa.
 *
 * No session: send to sign-in same as any other protected route (auth()
 * itself would also catch this, but redirecting here gives a cleaner URL
 * than falling through to the default sign-in flow). Signed in but not
 * admin: not-found, not a 403 — consistent with guardBrandPath's choice not
 * to reveal *why* access was refused, and reusing the existing not-found
 * page instead of adding a new one.
 */
function guardAdminPath(req: NextRequest, session: { isAdmin?: boolean } | null): NextResponse | null {
  const segments = req.nextUrl.pathname.split("/").filter(Boolean);
  const isAdminRoute = segments[0] === "admin" || (segments[0] === "api" && segments[1] === "admin");
  if (!isAdminRoute) return null;

  if (!session) {
    const signInUrl = new URL("/signin", req.url);
    return NextResponse.redirect(signInUrl);
  }

  if (!session.isAdmin) {
    return NextResponse.rewrite(new URL("/not-found", req.url));
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
  const user = req.auth?.user as { allowedBrands?: string[]; isAdmin?: boolean } | undefined;

  const guardedAdmin = guardAdminPath(req, req.auth ? { isAdmin: user?.isAdmin } : null);
  if (guardedAdmin) return guardedAdmin;

  const guarded = guardBrandPath(req, user?.allowedBrands ?? null);
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
  matcher: ["/((?!api/auth|api/health|api/og|signin|_next/static|_next/image|favicon.ico).*)"],
};
