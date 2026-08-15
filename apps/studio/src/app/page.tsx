import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { listAllDocuments, type DocSummary } from "@/lib/store";
import { UserChip } from "@/components/UserChip";
import { LibraryView } from "@/components/LibraryView";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  if (!session) redirect("/signin");

  // Docgent is one domain with the brand in the path, not one domain per
  // brand, so what a signed-in person is shown here is scoped by which
  // brands their account is allowed into (auth.ts's signIn/jwt callbacks),
  // not by which host they arrived on. An account allowed into every brand
  // sees every brand's documents on this single library page.
  const allowedBrands = (session.user as { allowedBrands?: string[] } | undefined)?.allowedBrands ?? [];

  let documents: DocSummary[] = [];
  let error: string | null = null;
  let errors: { brand: string; message: string }[] = [];

  try {
    // withLastCommit: the queue needs to know who touched a document last
    // and whether that was an agent, which frontmatter alone cannot answer.
    const res = await listAllDocuments({ withLastCommit: true });
    documents = res.documents.filter((d) => allowedBrands.includes(d.brand));
    errors = res.errors.filter((e) => allowedBrands.includes(e.brand));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="shell">
        <div className="main">
          <div className="topbar">
            <div>
              <div className="crumb">Documents</div>
              <h1 className="doc-title">Documents</h1>
            </div>
            <UserChip />
          </div>
          <div className="content">
            <div className="error-box">
              <strong>Could not read the repository.</strong>
              <div style={{ marginTop: 6 }}>
                <code>{error}</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {errors.length > 0 && (
        <div className="error-box" style={{ margin: "12px 20px 0" }}>
          <strong>
            {errors.length === 1
              ? "One brand could not be read."
              : `${errors.length} brands could not be read.`}
          </strong>
          <div style={{ marginTop: 6 }}>
            {errors.map((e) => (
              <div key={e.brand}>
                <strong>{e.brand}</strong> — <code>{e.message}</code>
              </div>
            ))}
          </div>
        </div>
      )}
      <LibraryView
        documents={documents}
        userChip={<UserChip />}
      />
    </>
  );
}
