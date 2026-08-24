"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { TimelineEntry } from "@/lib/store";
import { VersionPanel } from "@/components/VersionPanel";
import { DiffView, type DiffResult } from "@/components/DiffView";
import { CommentsPanel } from "@/components/CommentsPanel";
import { parseComments, setCommentResolved } from "@/lib/comments";

type DrawerTab = "changes" | "activity" | "details" | "comments";

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

const WORKFLOW_STATES = ["draft", "review", "approved", "released"] as const;
type WorkflowState = typeof WORKFLOW_STATES[number];

/**
 * Slim bar above the PDF: document title, state pipeline, primary CTA, drawer toggle.
 * Replaces the old right rail as the primary action surface.
 */
function DocActionBar({
  brand,
  slug,
  title,
  status,
  canEdit,
  pdfUrl,
  timeline,
  onCompare,
  drawerOpen,
  onToggleDrawer,
  openCommentCount,
}: {
  brand: string;
  slug: string;
  title: string;
  status: string;
  canEdit: boolean;
  pdfUrl: string;
  timeline: TimelineEntry[];
  onCompare: (baseSha: string, revision?: number) => void;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  openCommentCount: number;
}) {
  const [allowed, setAllowed] = useState<string[]>([]);
  const [transitioning, setTransitioning] = useState(false);
  const [statusState, setStatusState] = useState(status);

  // Fetch allowed transitions once on mount
  useMemo(() => {
    fetch(`/api/status/${brand}/${slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.allowed) { setStatusState(d.status); setAllowed(d.allowed); } })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand, slug]);

  const transition = useCallback(async (to: string) => {
    setTransitioning(true);
    try {
      const res = await fetch(`/api/status/${brand}/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      if (res.ok) window.location.reload();
    } finally {
      setTransitioning(false);
    }
  }, [brand, slug]);

  const currentIdx = WORKFLOW_STATES.indexOf(statusState as WorkflowState);
  const forwardTransitions = allowed.filter((t) => {
    if (t === "superseded") return false;
    return WORKFLOW_STATES.indexOf(t as WorkflowState) > currentIdx;
  });

  function ctaLabel(from: string, to: string): string {
    if (from === "draft" && to === "review") return "Submit for review";
    if (from === "review" && to === "approved") return "Approve";
    if (from === "approved" && to === "released") return "Release";
    return `Move to ${to.charAt(0).toUpperCase() + to.slice(1)}`;
  }

  const hasPreviousRevision = timeline.length >= 2;

  return (
    <div className="doc-action-bar">
      {/* Title */}
      <div className="doc-action-bar-title">{title}</div>

      {/* State pipeline */}
      <div className="doc-state-pipeline" aria-label="Document workflow state">
        {WORKFLOW_STATES.map((state, idx) => {
          const isDone = currentIdx > idx;
          const isActive = currentIdx === idx;
          return (
            <span key={state} className="doc-state-step" data-active={isActive} data-done={isDone}>
              {idx > 0 && <span className="doc-state-arrow" aria-hidden="true">›</span>}
              <span className="doc-state-label">{state}</span>
            </span>
          );
        })}
      </div>

      {/* Actions */}
      <div className="doc-action-bar-actions">
        {hasPreviousRevision && (
          <button
            className="btn btn-secondary"
            onClick={() => onCompare(timeline[1].sha, timeline[1].version)}
          >
            Compare
          </button>
        )}
        {canEdit && (
          <a className="btn btn-secondary" href={`/${brand}/${slug}/edit`}>Edit</a>
        )}
        <a className="btn btn-secondary" href={pdfUrl} target="_blank" rel="noreferrer">
          Open PDF ↗
        </a>
        {forwardTransitions.length > 0 && (
          <button
            className="btn btn-primary"
            disabled={transitioning}
            onClick={() => transition(forwardTransitions[0])}
          >
            {transitioning ? "…" : ctaLabel(statusState, forwardTransitions[0])}
          </button>
        )}
        <button
          className={`btn btn-secondary doc-drawer-toggle${drawerOpen ? " doc-drawer-toggle--open" : ""}`}
          onClick={onToggleDrawer}
          title={drawerOpen ? "Close panel" : "Open panel"}
          aria-expanded={drawerOpen}
        >
          {openCommentCount > 0 && !drawerOpen && (
            <span className="doc-drawer-badge">{openCommentCount}</span>
          )}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

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
  docTitle,
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
  docTitle?: string;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("changes");

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

  const runDiff = useCallback(async (baseSha: string, revision?: number) => {
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
      if (!res.ok) { setDiffError(data.error || `Diff failed (${res.status})`); return; }
      setDiff(data);
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiffing(false);
    }
  }, [brand, slug, viewingSha]);

  const closeDiff = useCallback(() => {
    setCompareBase(null);
    setDiff(null);
    setDiffError(null);
  }, []);

  const headLabel = viewingSha
    ? `r${timeline.find((t) => t.sha === viewingSha)?.version ?? "?"}`
    : "current";

  const title = docTitle || docMeta?.type || slug;

  return (
    <div className="doc-workspace">
      {/* Full-width action bar above the document */}
      <DocActionBar
        brand={brand}
        slug={slug}
        title={title}
        status={currentStatus}
        canEdit={canEdit}
        pdfUrl={pdfUrl}
        timeline={timeline}
        onCompare={runDiff}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((v) => !v)}
        openCommentCount={openCommentCount}
      />

      {/* Main content area: PDF (or diff) + optional drawer */}
      <div className="doc-workspace-body" data-drawer-open={drawerOpen}>
        {/* PDF / Diff pane — fills the space */}
        <div className="doc-pdf-pane">
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
            <>
              {!pdfLoaded && !pdfError && (
                <div className="pdf-skeleton-wrap" aria-label="Loading PDF">
                  {(docMeta?.type || docMeta?.status) && (
                    <div className="pdf-skeleton-meta">
                      {[docMeta?.type, docMeta?.status].filter(Boolean).join(" · ")}
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
              <iframe
                className="pdf-frame"
                src={pdfSrc}
                title="Document preview"
                onLoad={() => { setPdfLoaded(true); setPdfError(false); setPdfLoadedAt(Date.now()); }}
                onError={() => { setPdfError(true); setPdfLoaded(false); }}
                style={pdfLoaded ? { width: "100%", height: "100%", border: "none", display: "block" } : { opacity: 0, pointerEvents: "none", position: "absolute" }}
              />
              {pdfLoaded && pdfLoadedAt !== null && (
                <div className="pdf-rendered-at">
                  Rendered {new Date(pdfLoadedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
                </div>
              )}
            </>
          )}
        </div>

        {/* On-demand drawer: slides in from the right */}
        {drawerOpen && (
          <div className="doc-drawer">
            <div className="doc-drawer-tabs">
              {(["changes", "activity", "details", "comments"] as DrawerTab[]).map((t) => (
                <button
                  key={t}
                  className="doc-drawer-tab"
                  data-active={drawerTab === t}
                  onClick={() => setDrawerTab(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                  {t === "comments" && openCommentCount > 0 && (
                    <span className="rail-tab-badge">{openCommentCount}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="doc-drawer-body">
              {drawerTab === "changes" && (
                <VersionPanel
                  brand={brand} slug={slug} timeline={timeline}
                  currentStatus={currentStatus} viewingSha={viewingSha}
                  docVersion={docVersion} onCompare={runDiff}
                  comparingSha={compareBase} show="approval"
                />
              )}
              {drawerTab === "activity" && (
                <VersionPanel
                  brand={brand} slug={slug} timeline={timeline}
                  currentStatus={currentStatus} viewingSha={viewingSha}
                  docVersion={docVersion} onCompare={runDiff}
                  comparingSha={compareBase} show="activity"
                />
              )}
              {drawerTab === "details" && (
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
              {drawerTab === "comments" && (
                <CommentsPanel
                  comments={parsedComments}
                  onResolve={canEdit ? handleResolveComment : undefined}
                  canEdit={canEdit}
                  editHref={canEdit ? `/${brand}/${slug}/edit` : undefined}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
