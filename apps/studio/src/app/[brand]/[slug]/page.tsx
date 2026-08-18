import { auth } from "@/auth";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  storesFor,
  repoSlug,
  listAllDocuments,
  type DocSummary,
  type TimelineEntry,
} from "@/lib/store";
import { fetchDocPreviewMeta } from "@/lib/metadata";
import { Sidebar } from "@/components/Sidebar";
import { UserChip } from "@/components/UserChip";
import { DocumentWorkspace } from "@/components/DocumentWorkspace";
import { SignInPreview } from "@/components/SignInPreview";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ brand: string; slug: string }>;
  searchParams: Promise<{ v?: string }>;
};

/**
 * Link-preview metadata (Slack, iMessage, WhatsApp, Twitter/X, etc.).
 *
 * Runs on every request to this route regardless of session state -
 * crawlers never sign in, so this cannot depend on auth() the way the page
 * body does. See lib/metadata.ts for what it is and is not allowed to read.
 *
 * A commit-pinned view (`?v=<sha>`) gets metadata for that revision rather
 * than HEAD, so a link shared against an older version previews the
 * content that link actually points to.
 */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { brand, slug } = await params;
  const { v: commitSha } = await searchParams;

  const meta = await fetchDocPreviewMeta(brand, slug, commitSha);
  if (!meta) {
    return { title: "Docgent Studio", description: "Multi-brand document production" };
  }

  const title = meta.subtitle ? `${meta.title} — ${meta.subtitle}` : meta.title;
  const ogImageUrl = `/api/og/${brand}/${slug}${commitSha ? `?v=${commitSha}` : ""}`;

  return {
    title: `${title} · ${meta.brandName}`,
    description: meta.description,
    openGraph: {
      title,
      description: meta.description,
      siteName: `${meta.brandName} · Docgent`,
      type: "article",
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: meta.description,
      images: [ogImageUrl],
    },
  };
}

export default async function DocumentPage({ params, searchParams }: Props) {
  const session = await auth();
  const { brand, slug } = await params;
  const { v: commitSha } = await searchParams;

  // No session: this is either a human who has not signed in yet, or a
  // link-preview crawler (Slack, iMessage, WhatsApp, ...) that never will.
  // Both get the same lightweight, unauthenticated preview - real content
  // still requires signing in, but the <head> tags from generateMetadata
  // above are already on this response either way, so a crawler fetching
  // this URL gets a real preview instead of the generic site default a
  // hard redirect to /signin would have produced.
  if (!session) {
    const meta = await fetchDocPreviewMeta(brand, slug, commitSha);
    if (!meta) notFound();
    return <SignInPreview meta={meta} brand={brand} slug={slug} />;
  }

  // Docgent is one domain with the brand in the path, not one domain per
  // brand, so what gates access to this brand is the signed-in account's
  // allowed-brand list (auth.ts), the same list middleware.ts already
  // checked to let this request through at all. Checking again here is
  // defence in depth, and it also scopes the sidebar switcher below.
  const allowedBrands = (session.user as { allowedBrands?: string[] } | undefined)?.allowedBrands ?? [];
  if (!allowedBrands.includes(brand)) notFound();

  const { docs } = await storesFor(brand);

  let documents: DocSummary[] = [];
  try {
    // Sidebar spans every brand the signed-in account can reach, so the
    // switcher works from any document without ever offering one this
    // account is not allowed to open.
    const all = (await listAllDocuments()).documents;
    documents = all.filter((d) => allowedBrands.includes(d.brand));
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
/**
 * One document property in the header strip.
 *
 * The label is set in small caps and the value in normal text weight, so a
 * property reads as a document attribute rather than as escaped CMS data.
 *
 * The value itself is deliberately left verbatim. `doctype: strategic-report`
 * is a vocabulary identifier that selects a template, and it is the string an
 * author edits in frontmatter - prettifying it to "Strategic Report" in the
 * chrome would show a value that exists nowhere in the source, which is the
 * one thing this system is built not to do.
 */
function MetaChip({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <span className="meta-chip">
      <span className="meta-chip-key">{k}</span>
      <span className="meta-chip-val">{v}</span>
    </span>
  );
}
