import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { stores, repoSlug, type DocSummary } from "@/lib/store";
import { Sidebar } from "@/components/Sidebar";
import { UserChip } from "@/components/UserChip";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  if (!session) redirect("/signin");

  let documents: DocSummary[] = [];
  let error: string | null = null;

  try {
    const { docs } = stores();
    const res = await docs.listDocuments();
    documents = res.documents;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const brands = [...new Set(documents.map((d) => d.brand))];

  return (
    <div className="shell">
      <Sidebar documents={documents} />
      <div className="main">
        <div className="topbar">
          <div>
            <div className="crumb">{repoSlug()}</div>
            <h1 className="doc-title">Documents</h1>
          </div>
          <UserChip />
        </div>

        <div className="content">
          {error && (
            <div className="error-box">
              <strong>Could not read the repository.</strong>
              <div style={{ marginTop: 6 }}>
                <code>{error}</code>
              </div>
            </div>
          )}

          {!error && documents.length === 0 && (
            <div className="empty">
              No documents yet. Create one with{" "}
              <code>docforge new --brand &lt;id&gt; --title &quot;...&quot;</code>
            </div>
          )}

          {!error && documents.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <span>
                  {documents.length} document{documents.length > 1 ? "s" : ""} across{" "}
                  {brands.length} brand{brands.length > 1 ? "s" : ""}
                </span>
              </div>
              <div>
                {documents.map((d) => (
                  <Link
                    key={d.path}
                    href={`/${d.brand}/${d.slug}`}
                    className="version"
                    style={{ display: "block" }}
                  >
                    <div className="version-head">
                      <span className="version-num">{d.brand}</span>
                      <strong>{d.slug}</strong>
                    </div>
                    <div className="version-meta">
                      {d.path}
                      {d.assets.length > 0 && ` · ${d.assets.length} asset${d.assets.length > 1 ? "s" : ""}`}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
