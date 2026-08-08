import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

/**
 * Studio auth.
 *
 * Sign-in is restricted to members of a single GitHub org. We check membership
 * at sign-in time using the user's own token, then discard it — repo access
 * uses DOCFORGE_GH_TOKEN so permissions are governed by org membership rather
 * than by whatever scopes an individual happened to grant.
 */
const ALLOWED_ORG = process.env.DOCFORGE_ALLOWED_ORG || "";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      authorization: { params: { scope: "read:user user:email read:org" } },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
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
    },
    async jwt({ token, profile }) {
      if (profile?.login) token.login = profile.login as string;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { login?: string }).login = token.login as string;
      }
      return session;
    },
  },
  pages: { signIn: "/signin" },
});
