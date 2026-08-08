export { auth as middleware } from "@/auth";

export const config = {
  // Guard everything except auth endpoints, the sign-in page, the health
  // probe, and static assets.
  matcher: ["/((?!api/auth|api/health|signin|_next/static|_next/image|favicon.ico).*)"],
};
