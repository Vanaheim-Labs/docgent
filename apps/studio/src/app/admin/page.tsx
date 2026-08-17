import { auth, signOut } from "@/auth";

/**
 * Phase 1 landing page only — proves the admin gate works end to end
 * (middleware guard + isAdmin session flag). Brand config CRUD lands in a
 * later phase; this page intentionally does nothing beyond confirming
 * access, so there is nothing here yet to accidentally expose before the
 * real admin surface is built out.
 */
export default async function AdminHome() {
  const session = await auth();
  const email = session?.user?.email ?? "unknown";

  return (
    <div className="signin-wrap">
      <div className="signin-card">
        <h1 className="signin-title">Admin</h1>
        <p className="signin-sub">Signed in as {email}.</p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/signin" });
          }}
        >
          <button type="submit" className="btn" style={{ width: "100%" }}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
