import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { brandsForEmail } from "@/lib/store";

/**
 * The single admin account for the /admin area (brand config management,
 * not brand *content* — that stays gated by the per-brand access lists
 * above). Hardcoded rather than read from brand.yaml: admin access is a
 * property of the Studio deployment itself, not of any one brand, so it
 * does not belong in per-brand config. Revisit if/when multi-admin support
 * is needed.
 */
const ADMIN_EMAIL = "andrew@dcr.vc";

/**
 * Studio auth.
 *
 * Docgent is served from a single domain with the brand in the URL path
 * (docs.docgent.io/<brand>/<slug>), not one domain per brand, so there is no
 * host to resolve a brand from at sign-in time any more. Sign-in is Google
 * only, and the rule that decides who gets in is read from brand.yaml
 * `access:` blocks across every brand — not a shared environment-variable
 * allowlist. Two brands can never be governed by the same list by accident,
 * because there is no shared list.
 *
 * Signing in only proves membership in *at least one* brand; it does not by
 * itself grant every brand. The specific brand-in-path check happens per
 * request in middleware.ts, against the `allowedBrands` list this callback
 * writes onto the session below — that is what stops a correctly
 * authenticated Inkl user from opening /northface/<slug>.
 *
 * The check happens in the signIn callback, which runs server-side before a
 * session is issued — not client-side after the fact. A client-side check
 * only hides the UI; the session cookie would already be valid and every API
 * route would still trust it. Google is asked for a *verified* email only;
 * an unverified address proves nothing about who owns it.
 *
 * An email matching no brand's access list at all is rejected outright.
 * Fail closed, not "sign in with no brands".
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Studio is served behind a Cloudflare Worker proxy (proxy.docgent.io)
  // rather than direct Vercel domain attachment. Auth.js only trusts the
  // incoming Host header on multi-domain/proxied deployments when told to;
  // without this it silently drops the session, since the Host header
  // middleware sees does not match the deployment's own AUTH_URL.
  trustHost: true,
  providers: [
    Google({
      // Always show the chooser: guests are frequently signed into a
      // personal account already, and silently reusing it produces a
      // confusing denial.
      authorization: { params: { prompt: "select_account" } },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;

      const p = profile as { email?: string; email_verified?: boolean } | undefined;
      if (!p?.email || p.email_verified === false) return false;

      return brandsForEmail(p.email).length > 0; // fail closed: no brand, no sign-in
    },
    async jwt({ token, account, profile }) {
      if (account?.provider) token.provider = account.provider;
      // Computed once at sign-in (and whenever the token is otherwise
      // refreshed with a profile present), not on every request: brand
      // access rarely changes, and middleware needs this list on the Edge
      // runtime where re-reading brand.yaml off disk is not available.
      const p = profile as { email?: string } | undefined;
      if (p?.email) {
        token.allowedBrands = brandsForEmail(p.email).map((b) => b.id);
        // Computed once at sign-in for the same reason allowedBrands is:
        // middleware needs it on the Edge runtime without a disk read.
        token.isAdmin = p.email === ADMIN_EMAIL;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const u = session.user as { provider?: string; allowedBrands?: string[]; isAdmin?: boolean };
        if (token.provider) u.provider = token.provider as string;
        u.allowedBrands = (token.allowedBrands as string[] | undefined) ?? [];
        u.isAdmin = (token.isAdmin as boolean | undefined) ?? false;
      }
      return session;
    },
  },
  pages: { signIn: "/signin" },
});
