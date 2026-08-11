import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session) redirect("/");

  const { error } = await searchParams;

  const org = process.env.DOCFORGE_ALLOWED_ORG || "";
  // Google is only offered when an allowlist exists, because without one the
  // provider refuses every sign-in and the button would be a dead end.
  const googleEnabled =
    Boolean(process.env.AUTH_GOOGLE_ID) &&
    Boolean(
      (process.env.DOCFORGE_ALLOWED_EMAILS || "").trim() ||
        (process.env.DOCFORGE_ALLOWED_DOMAINS || "").trim()
    );

  return (
    <div className="signin-wrap">
      <div className="signin-card">
        <div className="wordmark" style={{ justifyContent: "center" }}>
          <span className="wordmark-dot" />
          DocForge Studio
        </div>
        <h1 className="signin-title">Sign in</h1>
        <p className="signin-sub">
          {org
            ? `${org} members sign in with GitHub. Invited collaborators sign in with Google.`
            : "Sign in to continue."}
        </p>

        {error && (
          <div className="error-box" style={{ marginBottom: 18, textAlign: "left" }}>
            <strong>Sign-in was refused.</strong>
            <div style={{ marginTop: 6 }}>
              That account is not on the access list for this Studio. Ask an
              administrator to add it, then try again.
            </div>
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: "/" });
            }}
          >
            <button type="submit" className="btn" style={{ width: "100%" }}>
              Continue with GitHub
            </button>
          </form>

          {googleEnabled && (
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="btn btn-secondary"
                style={{ width: "100%", fontSize: 14, padding: "10px 18px" }}
              >
                Continue with Google
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
