import { auth, signOut } from "@/auth";

export async function UserChip() {
  const session = await auth();
  if (!session?.user) return null;

  return (
    <div className="user-chip">
      {session.user.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="avatar" src={session.user.image} alt="" />
      )}
      <span>{session.user.name || session.user.email}</span>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/signin" });
        }}
      >
        <button type="submit" className="btn btn-secondary">
          Sign out
        </button>
      </form>
    </div>
  );
}
