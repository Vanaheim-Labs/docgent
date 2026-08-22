"use client";

import { useCallback, useRef, useState } from "react";
import type { TimelineEntry } from "@/lib/store";
import { VersionPanel } from "@/components/VersionPanel";
import { DiffView, type DiffResult } from "@/components/DiffView";

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
}: {
  brand: string;
  slug: string;
  timeline: TimelineEntry[];
  currentStatus: string;
  viewingSha?: string;
  docVersion?: string;
  pdfUrl: string;
  canEdit: boolean;
}) {
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
                Open
              </a>
            </span>
          </div>
          <div className="pdf-panel-wrap">
            {!pdfLoaded && !pdfError && (
              <div className="pdf-loading" aria-label="Loading PDF">
                <div className="pdf-loading-spinner" />
                <span>Rendering PDF…</span>
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
              style={pdfLoaded ? undefined : { opacity: 0, pointerEvents: "none" }}
            />
          </div>
          {pdfLoaded && pdfLoadedAt !== null && (
            <div style={{ padding: "4px 16px 8px", fontSize: 11, color: "var(--ink-faint)" }}>
              Last rendered {new Date(pdfLoadedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gap: 16 }}>
        <VersionPanel
          brand={brand}
          slug={slug}
          timeline={timeline}
          currentStatus={currentStatus}
          viewingSha={viewingSha}
          docVersion={docVersion}
          onCompare={runDiff}
          comparingSha={compareBase}
        />
      </div>
    </div>
  );
}
