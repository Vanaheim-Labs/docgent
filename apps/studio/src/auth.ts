import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

/**
 * Studio auth.
 *
 * Two ways in, deliberately gated differently:
 *
 *  - GitHub  -> must be a member of DOCFORGE_ALLOWED_ORG. This is the path for
 *               the team that also holds repo access.
 *  - Google  -> must appear in DOCFORGE_ALLOWED_EMAILS, optionally widened by
 *               DOCFORGE_ALLOWED_DOMAINS. This is the path for collaborators
 *               (clients, reviewers) who have no GitHub account and should not
 *               be given an org seat just to read a document.
 *
 * In both cases the identity token is used only to decide "may this person in",
 * then discarded. Repo reads and writes always run through DOCFORGE_GH_TOKEN,
 * so a Google guest never gains repository permissions of any kind.
 */
const ALLOWED_ORG = process.env.DOCFORGE_ALLOWED_ORG || "";

/** Comma-separated exact addresses, e.g. "scott@inkl.com,jane@example.com". */
const ALLOWED_EMAILS = (process.env.DOCFORGE_ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/** Comma-separated bare domains, e.g. "inkl.com". Empty by default: a whole
 *  domain is a much larger grant than it looks, so it must be opted into. */
const ALLOWED_DOMAINS = (process.env.DOCFORGE_ALLOWED_DOMAINS || "")
  .split(",")
  .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
  .filter(Boolean);

function googleAllowed(email?: string | null, verified?: boolean): boolean {
  if (!email) return false;
  // An unverified Google address proves nothing about who owns it.
  if (verified === false) return false;

  const addr = email.toLowerCase();
  if (ALLOWED_EMAILS.includes(addr)) return true;

  const domain = addr.split("@")[1] || "";
  return ALLOWED_DOMAINS.includes(domain);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      authorization: { params: { scope: "read:user user:email read:org" } },
    }),
    Google({
      // Always show the chooser: guests are frequently signed into a personal
      // account already, and silently reusing it produces a confusing denial.
      authorization: { params: { prompt: "select_account" } },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "google") {
        // Fail closed. If neither allowlist is configured, no Google guest
        // gets in, rather than every Google account on earth.
        if (ALLOWED_EMAILS.length === 0 && ALLOWED_DOMAINS.length === 0) {
          return false;
        }
        const p = profile as { email?: string; email_verified?: boolean } | undefined;
        return googleAllowed(p?.email, p?.email_verified);
      }

      if (account?.provider === "github") {
        if (!ALLOWED_ORG) return true; // unrestricted only if explicitly unset
        const token = account?.access_token;
        if (!token) return false;

        try {
          const res = await fetch(
            `https://api.github.com/orgs/${ALLOWED_ORG}/members/${profile?.login}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
              },
            }
          );
          // 204 = member, 302/404 = not a member or not visible
          return res.status === 204;
        } catch {
          return false;
        }
      }

      return false;
    },
    async jwt({ token, profile, account }) {
      if (account?.provider === "github" && profile?.login) {
        token.login = profile.login as string;
      }
      if (account?.provider) token.provider = account.provider;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const u = session.user as { login?: string; provider?: string };
        if (token.login) u.login = token.login as string;
        if (token.provider) u.provider = token.provider as string;
      }
      return session;
    },
  },
  pages: { signIn: "/signin" },
});
