import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { listAllDocuments, type DocSummary } from "@/lib/store";
import { UserChip } from "@/components/UserChip";
import { LibraryView } from "@/components/LibraryView";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  if (!session) redirect("/signin");

  let documents: DocSummary[] = [];
  let error: string | null = null;
  let errors: { brand: string; message: string }[] = [];

  try {
    // withLastCommit: the queue needs to know who touched a document last
    // and whether that was an agent, which frontmatter alone cannot answer.
    const res = await listAllDocuments({ withLastCommit: true });
    documents = res.documents;
    errors = res.errors;
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
      <LibraryView documents={documents} userChip={<UserChip />} />
    </>
  );
}
