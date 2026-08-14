import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { headers } from "next/headers";
import { resolveBrandForHost } from "@/lib/store";

/**
 * Studio auth.
 *
 * Each production domain is dedicated to exactly one brand (see
 * DOCGENT_HOST_BRANDS / resolveBrandForHost in lib/store.ts). Sign-in is
 * Google only, and the rule that decides who gets in is read from that
 * brand's brand.yaml `access:` block — not a shared environment-variable
 * allowlist. Two brands can never be governed by the same list by accident,
 * because there is no shared list.
 *
 * The check happens in the signIn callback, which runs server-side before a
 * session is issued — not client-side after the fact. A client-side check
 * only hides the UI; the session cookie would already be valid and every API
 * route would still trust it. Google is asked for a *verified* email only;
 * an unverified address proves nothing about who owns it.
 *
 * A host with no brand mapping (local dev without DOCGENT_HOST_BRANDS set,
 * or anyone hitting the raw Vercel URL) resolves to no brand and rejects
 * every sign-in. Fail closed, not "pick a default brand".
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
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

      const host = (await headers()).get("host");
      const brand = resolveBrandForHost(host);
      if (!brand) return false; // unmapped host — fail closed

      const addr = p.email.toLowerCase();
      if (brand.access.emails.includes(addr)) return true;

      const domain = addr.split("@")[1] || "";
      return brand.access.domains.includes(domain);
    },
    async jwt({ token, account }) {
      if (account?.provider) token.provider = account.provider;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const u = session.user as { provider?: string };
        if (token.provider) u.provider = token.provider as string;
      }
      return session;
    },
  },
  pages: { signIn: "/signin" },
});
