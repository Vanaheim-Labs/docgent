import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;
  // Only local absolute paths: reject protocol-relative URLs, backslashes
  // and controls before passing an untrusted query parameter to OAuth.
  const returnTo = typeof callbackUrl === "string" && callbackUrl.startsWith("/") &&
    !callbackUrl.startsWith("//") && !/[\\\\\u0000-\u0020\u007f]/.test(callbackUrl)
    ? callbackUrl : "/";
  const session = await auth();
  if (session) redirect(returnTo);

  return (
    <div className="signin-wrap">
      <div className="signin-card">
        <div className="wordmark" style={{ justifyContent: "center" }}>
          <img src="/docgent-logo.svg" alt="Docgent" className="wordmark-logo" />
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
              await signIn("google", { redirectTo: returnTo });
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
