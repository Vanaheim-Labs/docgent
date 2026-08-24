"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { TimelineEntry } from "@/lib/store";
import { VersionPanel } from "@/components/VersionPanel";
import { DiffView, type DiffResult } from "@/components/DiffView";
import { CommentsPanel } from "@/components/CommentsPanel";
import { parseComments, setCommentResolved } from "@/lib/comments";

type RailTab = "changes" | "activity" | "details" | "comments";

type DocMeta = {
  type?: string;
  version?: string;
  date?: string;
  client?: string;
  author?: string;
  reference?: string;
  status?: string;
  classification?: string;
};

function MetaRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="meta-row">
      <span className="meta-key">{label}</span>
      <span className="meta-val">{value}</span>
    </div>
  );
}

/** Strip conventional-commit prefix for display in the banner. */
function displaySubject(subject: string): string {
  const m = subject.match(/^[a-z]+(?:\([^)]*\))?!?:\s*(.+)$/);
  return (m ? m[1] : subject).trim() || subject;
}

function timeAgo(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return "just now";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return `${Math.floor(day / 30)}mo ago`;
}

/**
 * Banner shown above the PDF when there are multiple timeline entries.
 * Summarises the latest change and offers a quick path to the diff.
 */
function ChangeBanner({
  timeline,
  onCompare,
}: {
  timeline: TimelineEntry[];
  onCompare: (baseSha: string, revision?: number) => void;
}) {
  if (timeline.length < 2) return null;

  const latest = timeline[0];
  const previous = timeline[1];
  const authorName = latest.author.name || latest.author.login || "unknown";
  const isAgent =
    latest.author.email?.includes("[bot]") ||
    /\bbot\b/i.test(latest.author.name || "") ||
    latest.author.name === "Docgent Studio";
  const when = timeAgo(latest.author.date);
  const subject = displaySubject(latest.subject);

  return (
    <div className="change-banner">
      <div className="change-banner-info">
        <span className="change-banner-title">
          r{latest.version} — {subject}
        </span>
        <span className="change-banner-sub">
          {timeline.length} revisions · last changed by{" "}
          {isAgent ? "🤖 " : ""}{authorName}{when ? ` ${when}` : ""}
        </span>
      </div>
      <button
        className="btn btn-primary"
        onClick={() => onCompare(previous.sha, previous.version)}
      >
        Compare changes
      </button>
    </div>
  );
}

/**
 * Owns the compare state for a document.
 *
 * The diff lives here rather than inside VersionPanel because it needs the
 * wide column: rendered into the 340px rail alongside the revision list, a
 * paragraph of prose became a ribbon a few words wide. Hoisting the state
 * lets the sidebar trigger a comparison that renders in the main pane.
 */
export function DocumentWorkspace({
  brand,
  slug,
  timeline,
  currentStatus,
  viewingSha,
  docVersion,
  pdfUrl,
  canEdit,
  docMeta,
  docSource,
}: {
  brand: string;
  slug: string;
  timeline: TimelineEntry[];
  currentStatus: string;
  viewingSha?: string;
  docVersion?: string;
  pdfUrl: string;
  canEdit: boolean;
  docMeta?: DocMeta;
  docSource?: string;
}) {
  const [railTab, setRailTab] = useState<RailTab>("changes");
  const [docSourceState, setDocSourceState] = useState(docSource ?? "");
  const parsedComments = useMemo(() => parseComments(docSourceState), [docSourceState]);
  const openCommentCount = parsedComments.filter((c) => !c.resolved).length;

  const handleResolveComment = useCallback((id: string, resolved: boolean) => {
    setDocSourceState((prev) => setCommentResolved(prev, id, resolved));
  }, []);
  const [compareBase, setCompareBase] = useState<string | null>(null);
  const [compareLabel, setCompareLabel] = useState<string>("");
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffing, setDiffing] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [pdfError, setPdfError] = useState(false);
  const [pdfLoadedAt, setPdfLoadedAt] = useState<number | null>(null);
  const [pdfSrc, setPdfSrc] = useState(pdfUrl);
  const pdfReloadRef = useRef(0);

  const runDiff = useCallback(
    async (baseSha: string, revision?: number) => {
      setCompareBase(baseSha);
      setCompareLabel(revision ? `r${revision}` : baseSha.slice(0, 7));
      setDiffing(true);
      setDiff(null);
      setDiffError(null);
      try {
        const qs = new URLSearchParams({ base: baseSha });
        if (viewingSha) qs.set("head", viewingSha);
        const res = await fetch(`/api/diff/${brand}/${slug}?${qs}`);
        const data = await res.json();
        if (!res.ok) {
          setDiffError(data.error || `Diff failed (${res.status})`);
          return;
        }
        setDiff(data);
      } catch (e) {
        setDiffError(e instanceof Error ? e.message : String(e));
      } finally {
        setDiffing(false);
      }
    },
    [brand, slug, viewingSha]
  );

  const closeDiff = useCallback(() => {
    setCompareBase(null);
    setDiff(null);
    setDiffError(null);
  }, []);

  const headLabel = viewingSha
    ? `r${timeline.find((t) => t.sha === viewingSha)?.version ?? "?"}`
    : "current";

  return (
    <div className="grid">
      {!compareBase && timeline.length >= 2 && (
        <div style={{ gridColumn: "1 / -1" }}>
          <ChangeBanner timeline={timeline} onCompare={runDiff} />
        </div>
      )}
      {compareBase ? (
        <DiffView
          baseLabel={compareLabel}
          headLabel={headLabel}
          fileLabel={`documents/${slug}/doc.md`}
          diff={diff}
          diffing={diffing}
          error={diffError}
          onClose={closeDiff}
        />
      ) : (
        <div className="panel">
          <div className="panel-head">
            <span>Rendered PDF</span>
            <span style={{ display: "flex", gap: 8 }}>
              {canEdit && (
                <a className="btn btn-secondary" href={`/${brand}/${slug}/edit`}>
                  Edit
                </a>
              )}
              <a className="btn btn-secondary" href={pdfUrl} target="_blank" rel="noreferrer">
                Open PDF ↗
              </a>
            </span>
          </div>
          <div className="pdf-panel-wrap">
            {!pdfLoaded && !pdfError && (
              <div className="pdf-skeleton-wrap" aria-label="Loading PDF">
                {(docMeta?.type || docMeta?.status) && (
                  <div className="pdf-skeleton-meta">
                    {[docMeta.type, docMeta.status].filter(Boolean).join(" · ")}
                  </div>
                )}
                <span className="pdf-skeleton" aria-hidden="true" />
                <div className="pdf-loading-spinner" style={{ marginTop: 8 }} />
                <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>Rendering PDF…</span>
              </div>
            )}
            {pdfError && (
              <div className="pdf-error" role="alert">
                <span>PDF failed to render.</span>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    pdfReloadRef.current += 1;
                    setPdfError(false);
                    setPdfLoaded(false);
                    setPdfSrc(`${pdfUrl}${pdfUrl.includes("?") ? "&" : "?"}_r=${pdfReloadRef.current}`);
                  }}
                >
                  Try again
                </button>
              </div>
            )}
            <div className="pdf-frame-outer">
              <iframe
                className="pdf-frame"
                src={pdfSrc}
                title="Document preview"
                onLoad={() => { setPdfLoaded(true); setPdfError(false); setPdfLoadedAt(Date.now()); }}
                onError={() => { setPdfError(true); setPdfLoaded(false); }}
                style={pdfLoaded ? undefined : { opacity: 0, pointerEvents: "none" }}
              />
            </div>
          </div>
          {pdfLoaded && pdfLoadedAt !== null && (
            <div style={{ padding: "4px 16px 8px", fontSize: 11, color: "var(--ink-faint)" }}>
              Last rendered {new Date(pdfLoadedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>
      )}

      {/* Tabbed right rail: Changes | Activity | Details | Comments */}
      <div className="rail">
        <div className="rail-tabs">
          {(["changes", "activity", "details"] as ("changes" | "activity" | "details")[]).map((t) => (
            <button
              key={t}
              className="rail-tab"
              data-active={railTab === t}
              onClick={() => setRailTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
          <button
            className="rail-tab"
            data-active={railTab === "comments"}
            onClick={() => setRailTab("comments")}
          >
            Comments
            {openCommentCount > 0 && (
              <span className="rail-tab-badge">{openCommentCount}</span>
            )}
          </button>
        </div>

        {railTab === "changes" && (
          <VersionPanel
            brand={brand}
            slug={slug}
            timeline={timeline}
            currentStatus={currentStatus}
            viewingSha={viewingSha}
            docVersion={docVersion}
            onCompare={runDiff}
            comparingSha={compareBase}
            show="approval"
          />
        )}

        {railTab === "activity" && (
          <VersionPanel
            brand={brand}
            slug={slug}
            timeline={timeline}
            currentStatus={currentStatus}
            viewingSha={viewingSha}
            docVersion={docVersion}
            onCompare={runDiff}
            comparingSha={compareBase}
            show="activity"
          />
        )}

        {railTab === "details" && (
          <div className="panel">
            <div className="panel-head">Details</div>
            <div className="panel-body">
              {docMeta ? (
                <>
                  <MetaRow label="Type" value={docMeta.type} />
                  <MetaRow label="Version" value={docMeta.version} />
                  <MetaRow label="Date" value={docMeta.date} />
                  <MetaRow label="Client" value={docMeta.client} />
                  <MetaRow label="Author" value={docMeta.author} />
                  <MetaRow label="Reference" value={docMeta.reference} />
                  <MetaRow label="Status" value={docMeta.status} />
                  <MetaRow label="Classification" value={docMeta.classification} />
                </>
              ) : (
                <div style={{ color: "var(--ink-faint)", fontSize: 13 }}>No metadata available.</div>
              )}
            </div>
          </div>
        )}

        {railTab === "comments" && (
          <CommentsPanel
            comments={parsedComments}
            onResolve={canEdit ? handleResolveComment : undefined}
            canEdit={canEdit}
            editHref={canEdit ? `/${brand}/${slug}/edit` : undefined}
          />
        )}
      </div>
    </div>
  );
}
