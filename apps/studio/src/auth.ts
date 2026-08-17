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
      const p = profile as { email?: string } | undefined;
      // Recompute on every jwt() call where we have an email — either from
      // the OAuth profile (first sign-in) or from the persisted token.email
      // (subsequent requests). This ensures isAdmin and allowedBrands are
      // always current even for sessions issued before this field existed,
      // without requiring a sign-out/sign-in cycle to pick up new values.
      const email = p?.email ?? (typeof token.email === "string" ? token.email : undefined);
      if (email) {
        token.allowedBrands = brandsForEmail(email).map((b) => b.id);
        token.isAdmin = email === ADMIN_EMAIL;
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
