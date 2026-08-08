import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function SignIn() {
  const session = await auth();
  if (session) redirect("/");

  const org = process.env.DOCFORGE_ALLOWED_ORG || "";

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
            ? `Restricted to members of the ${org} organisation.`
            : "Sign in with GitHub to continue."}
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/" });
          }}
        >
          <button type="submit" className="btn">
            Continue with GitHub
          </button>
        </form>
      </div>
    </div>
  );
}
