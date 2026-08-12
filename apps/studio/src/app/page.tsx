import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { listAllDocuments, resolveBrandForHost, type DocSummary } from "@/lib/store";
import { UserChip } from "@/components/UserChip";
import { LibraryView } from "@/components/LibraryView";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  if (!session) redirect("/signin");

  // A dedicated brand domain (docs.inkl.com etc.) shows only that brand's
  // documents — the domain boundary Andrew asked for is not just about who
  // can sign in, it is what the signed-in person is shown. On a host with
  // no brand mapping (local dev, the raw Vercel URL) every brand is shown,
  // same as before.
  const host = (await headers()).get("host");
  const lockedBrand = resolveBrandForHost(host);

  let documents: DocSummary[] = [];
  let error: string | null = null;
  let errors: { brand: string; message: string }[] = [];

  try {
    // withLastCommit: the queue needs to know who touched a document last
    // and whether that was an agent, which frontmatter alone cannot answer.
    const res = await listAllDocuments({ withLastCommit: true });
    documents = lockedBrand
      ? res.documents.filter((d) => d.brand === lockedBrand.id)
      : res.documents;
    errors = lockedBrand
      ? res.errors.filter((e) => e.brand === lockedBrand.id)
      : res.errors;
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
        lockedBrand={lockedBrand ? { id: lockedBrand.id, name: lockedBrand.name } : null}
      />
    </>
  );
}
