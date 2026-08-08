import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { stores, repoSlug, type DocSummary, type TimelineEntry } from "@/lib/store";
import { Sidebar } from "@/components/Sidebar";
import { UserChip } from "@/components/UserChip";

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

  const { docs } = stores();

  let documents: DocSummary[] = [];
  try {
    documents = (await docs.listDocuments()).documents;
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
              {repoSlug()} · <strong>{brand}</strong>
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
              Viewing version {viewing?.version ?? "?"} ({commitSha.slice(0, 7)}) —{" "}
              <a href={`/${brand}/${slug}`}>back to current</a>
            </div>
          )}

          <div className="grid">
            <div className="panel">
              <div className="panel-head">
                <span>Rendered PDF</span>
                <a className="btn btn-secondary" href={pdfUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
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

              <div className="panel">
                <div className="panel-head">
                  <span>Version history</span>
                  <span style={{ textTransform: "none", letterSpacing: 0 }}>
                    {timeline.length}
                  </span>
                </div>
                {timelineError && (
                  <div className="panel-body">
                    <div className="error-box">
                      <code>{timelineError}</code>
                    </div>
                  </div>
                )}
                {!timelineError && timeline.length === 0 && (
                  <div className="panel-body" style={{ color: "var(--ink-faint)", fontSize: 13 }}>
                    No commits found for this path.
                  </div>
                )}
                <div>
                  {timeline.map((t) => (
                    <a
                      key={t.sha}
                      className="version"
                      href={t.isCurrent ? `/${brand}/${slug}` : `/${brand}/${slug}?v=${t.sha}`}
                      data-current={commitSha ? t.sha === commitSha : t.isCurrent}
                    >
                      <div className="version-head">
                        <span className="version-num">v{t.version}</span>
                        <span className="version-sha">{t.shortSha}</span>
                        {t.isCurrent && (
                          <span className="badge" style={{ marginLeft: "auto" }}>
                            current
                          </span>
                        )}
                      </div>
                      <div className="version-subject">{t.subject}</div>
                      <div className="version-meta">
                        {t.author.name || t.author.login || "unknown"}
                        {t.author.date && ` · ${new Date(t.author.date).toLocaleDateString("en-AU", {
                          day: "numeric", month: "short", year: "numeric",
                        })}`}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
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
