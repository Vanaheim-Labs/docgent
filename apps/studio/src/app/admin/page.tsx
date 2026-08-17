import { auth, signOut } from "@/auth";
import Link from "next/link";

/**
 * Landing page grew from a bare "signed in as X" proof-of-gate (Phase 1)
 * into the entry point for brand management (Phase 2). Still deliberately
 * thin — the real work happens under /admin/brands.
 */
export default async function AdminHome() {
  const session = await auth();
  const email = session?.user?.email ?? "unknown";

  return (
    <div className="signin-wrap">
      <div className="signin-card">
        <h1 className="signin-title">Admin</h1>
        <p className="signin-sub">Signed in as {email}.</p>
        <div style={{ display: "grid", gap: 10, marginTop: 4 }}>
          <Link href="/admin/brands" className="btn" style={{ width: "100%", textAlign: "center" }}>
            Manage brands
          </Link>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button type="submit" className="btn btn-secondary" style={{ width: "100%" }}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
