import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { storesFor, repoSlug, listAllDocuments, type DocSummary, type TimelineEntry } from "@/lib/store";
import { Sidebar } from "@/components/Sidebar";
import { UserChip } from "@/components/UserChip";
import { DocumentWorkspace } from "@/components/DocumentWorkspace";

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

          <div className="doc-meta-strip">
            <MetaChip k="Type" v={fm.doctype} />
            <MetaChip k="Version" v={fm.version} />
            <MetaChip k="Date" v={fm.date} />
            {fm.client && <MetaChip k="Client" v={fm.client} />}
            {fm.author && <MetaChip k="Author" v={fm.author} />}
            {fm.reference && <MetaChip k="Ref" v={fm.reference} />}
            <span className="badge" data-status={fm.status}>{fm.status || "—"}</span>
            <span className="badge" data-class={fm.classification}>
              {fm.classification || "—"}
            </span>
          </div>

          {timelineError ? (
            <div className="panel">
              <div className="panel-head">Version history</div>
              <div className="panel-body">
                <div className="error-box"><code>{timelineError}</code></div>
              </div>
            </div>
          ) : (
            <DocumentWorkspace
              brand={brand}
              slug={slug}
              timeline={timeline}
              currentStatus={fm.status || "draft"}
              viewingSha={commitSha}
              docVersion={fm.version}
              pdfUrl={pdfUrl}
              canEdit={!commitSha}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Compact inline metadata, freeing the rail for history and the pane for content. */
function MetaChip({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <span className="meta-chip">
      <span className="meta-chip-key">{k}</span>
      <span className="meta-chip-val">{v}</span>
    </span>
  );
}
