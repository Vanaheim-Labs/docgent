import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { brands, listAllDocuments, type DocSummary } from "@/lib/store";
import { Sidebar } from "@/components/Sidebar";
import { UserChip } from "@/components/UserChip";
import { DocCard } from "@/components/DocCard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  if (!session) redirect("/signin");

  let documents: DocSummary[] = [];
  let error: string | null = null;
  let errors: { brand: string; message: string }[] = [];

  try {
    const res = await listAllDocuments();
    documents = res.documents;
    errors = res.errors;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const configured = brands();

  // Grouped by brand, because a brand is a real boundary here — its own repo,
  // its own access. A flat list implies documents are interchangeable when
  // they are not.
  const byBrand = new Map<string, DocSummary[]>();
  for (const d of documents) {
    if (!byBrand.has(d.brand)) byBrand.set(d.brand, []);
    byBrand.get(d.brand)!.push(d);
  }

  const brandName = (id: string) =>
    byBrand.get(id)?.[0]?.brandName ||
    configured.find((b) => b.id === id)?.name ||
    id;

  return (
    <div className="shell">
      <Sidebar documents={documents} errors={errors} />
      <div className="main">
        <div className="topbar">
          <div>
            <div className="crumb">
              {documents.length} document{documents.length === 1 ? "" : "s"}
              {byBrand.size > 0 && (
                <>
                  {" · "}
                  {byBrand.size} brand{byBrand.size === 1 ? "" : "s"}
                </>
              )}
            </div>
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

          {/* A brand whose store failed is named, so an unreachable repo is
              never mistaken for a brand with no documents. */}
          {errors.length > 0 && (
            <div className="error-box" style={{ marginBottom: 20 }}>
              <strong>
                {errors.length === 1
                  ? "One brand could not be read."
                  : `${errors.length} brands could not be read.`}
              </strong>
              <div style={{ marginTop: 6 }}>
                {errors.map((e) => (
                  <div key={e.brand}>
                    <strong>{brandName(e.brand)}</strong> — <code>{e.message}</code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!error && documents.length === 0 && (
            <div className="empty">
              No documents yet. Create one with{" "}
              <code>docforge new --brand &lt;id&gt; --title &quot;...&quot;</code>
            </div>
          )}

          {[...byBrand.entries()].map(([brand, docs]) => (
            <section className="brand-section" key={brand}>
              <div className="section-head">
                <h2 className="section-title">{brandName(brand)}</h2>
                <span className="section-count">
                  {docs.length} document{docs.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="doc-grid">
                {docs.map((d) => (
                  <DocCard key={d.path} doc={d} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
