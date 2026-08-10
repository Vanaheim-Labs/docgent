import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { storesFor, repoSlug, listAllDocuments, type DocSummary, type TimelineEntry } from "@/lib/store";
import { Sidebar } from "@/components/Sidebar";
import { UserChip } from "@/components/UserChip";
import { VersionPanel } from "@/components/VersionPanel";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ brand: string; slug: string }>;
  searchParams: Promise<{ v?: string }>;
};

export default async function DocumentPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session) redirect("/signin");

  const { brand, slug } = await params;
  const { v: commitSha } = await searchParams;

  const { docs } = storesFor(brand);

  let documents: DocSummary[] = [];
  try {
    // Sidebar spans every brand so the switcher works from any document.
    documents = (await listAllDocuments()).documents;
  } catch {
    // sidebar degrades to empty rather than failing the page
  }

  let doc;
  try {
    doc = commitSha
      ? await docs.readAt(brand, slug, commitSha)
      : await docs.readDocument(brand, slug);
  } catch {
    notFound();
  }

  let timeline: TimelineEntry[] = [];
  let timelineError: string | null = null;
  try {
    timeline = await docs.timeline(brand, slug, { limit: 30 });
  } catch (e) {
    timelineError = e instanceof Error ? e.message : String(e);
  }

  const fm = doc.frontmatter || {};
  const viewing = commitSha
    ? timeline.find((t) => t.sha === commitSha)
    : timeline[0];

  const pdfUrl =
    `/api/render/${brand}/${slug}` + (commitSha ? `?ref=${commitSha}` : "");

  return (
    <div className="shell">
      <Sidebar documents={documents} activeBrand={brand} activeSlug={slug} />
      <div className="main">
        <div className="topbar">
          <div>
            <div className="crumb">
              {repoSlug(brand)} · <strong>{brand}</strong>
            </div>
            <h1 className="doc-title">{fm.title || slug}</h1>
          </div>
          <UserChip />
        </div>

        <div className="content">
          {commitSha && (
            <div
              className="error-box"
              style={{
                background: "var(--accent-soft)",
                borderColor: "#cfe0ec",
                color: "var(--accent)",
                marginBottom: 16,
              }}
            >
              Viewing revision {viewing?.version ?? "?"} ({commitSha.slice(0, 7)})
              {fm.version ? ` · document version ${fm.version}` : ""} —{" "}
              <a href={`/${brand}/${slug}`}>back to current</a>
            </div>
          )}

          <div className="grid">
            <div className="panel">
              <div className="panel-head">
                <span>Rendered PDF</span>
                <span style={{ display: "flex", gap: 8 }}>
                  {!commitSha && (
                    <a className="btn btn-secondary" href={`/${brand}/${slug}/edit`}>
                      Edit
                    </a>
                  )}
                  <a className="btn btn-secondary" href={pdfUrl} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </span>
              </div>
              <iframe className="pdf-frame" src={pdfUrl} title="Document preview" />
            </div>

            <div style={{ display: "grid", gap: 16 }}>
              <div className="panel">
                <div className="panel-head">Metadata</div>
                <div className="panel-body">
                  <MetaRow k="Brand" v={brand} />
                  <MetaRow k="Type" v={fm.doctype} />
                  <MetaRow k="Version" v={fm.version} />
                  <MetaRow k="Date" v={fm.date} />
                  {fm.client && <MetaRow k="Client" v={fm.client} />}
                  {fm.author && <MetaRow k="Author" v={fm.author} />}
                  {fm.reference && <MetaRow k="Reference" v={fm.reference} />}
                  <div className="meta-row">
                    <span className="meta-key">Status</span>
                    <span className="meta-val">
                      <span className="badge" data-status={fm.status}>
                        {fm.status || "—"}
                      </span>
                    </span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-key">Classification</span>
                    <span className="meta-val">
                      <span className="badge" data-class={fm.classification}>
                        {fm.classification || "—"}
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {timelineError ? (
                <div className="panel">
                  <div className="panel-head">Version history</div>
                  <div className="panel-body">
                    <div className="error-box">
                      <code>{timelineError}</code>
                    </div>
                  </div>
                </div>
              ) : (
                <VersionPanel
                  brand={brand}
                  slug={slug}
                  timeline={timeline}
                  currentStatus={fm.status || "draft"}
                  viewingSha={commitSha}
                  docVersion={fm.version}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaRow({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <div className="meta-row">
      <span className="meta-key">{k}</span>
      <span className="meta-val">{v}</span>
    </div>
  );
}
