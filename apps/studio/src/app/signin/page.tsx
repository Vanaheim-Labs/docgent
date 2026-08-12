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

  return (
    <div className="signin-wrap">
      <div className="signin-card">
        <div className="wordmark" style={{ justifyContent: "center" }}>
          <span className="wordmark-dot" />
          DocForge Studio
        </div>
        <h1 className="signin-title">Sign in</h1>
        <p className="signin-sub">Sign in with Google to continue.</p>

        {error && (
          <div className="error-box" style={{ marginBottom: 18, textAlign: "left" }}>
            <strong>Sign-in was refused.</strong>
            <div style={{ marginTop: 6 }}>
              That account is not authorised for this Studio. Ask an
              administrator to add it, then try again.
            </div>
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <button type="submit" className="btn" style={{ width: "100%" }}>
              Continue with Google
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
