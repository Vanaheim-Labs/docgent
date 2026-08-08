"use client";

import { useCallback, useEffect, useState } from "react";
import type { TimelineEntry } from "@/lib/store";

type Change = {
  type: string;
  detail: string;
  section?: string;
  block?: string;
  key?: string;
  before?: string;
  after?: string;
};

type DiffResult = {
  headline: string;
  summary: Record<string, number>;
  changes: Change[];
};

const SEVERITY: Record<string, "add" | "remove" | "edit" | "meta"> = {
  block_added: "add",
  section_added: "add",
  prose_added: "add",
  metadata_added: "add",
  block_removed: "remove",
  section_removed: "remove",
  prose_removed: "remove",
  metadata_removed: "remove",
  block_edited: "edit",
  prose_edited: "edit",
  attribute_changed: "meta",
  metadata_changed: "meta",
};

const LABEL: Record<string, string> = {
  block_added: "added",
  block_removed: "removed",
  block_edited: "edited",
  attribute_changed: "value",
  section_added: "section",
  section_removed: "section",
  prose_added: "prose",
  prose_removed: "prose",
  prose_edited: "prose",
  metadata_added: "meta",
  metadata_removed: "meta",
  metadata_changed: "meta",
};

export function VersionPanel({
  brand,
  slug,
  timeline,
  currentStatus,
  viewingSha,
}: {
  brand: string;
  slug: string;
  timeline: TimelineEntry[];
  currentStatus: string;
  viewingSha?: string;
}) {
  const [compareBase, setCompareBase] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffing, setDiffing] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const [status, setStatus] = useState(currentStatus);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [transitioning, setTransitioning] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/status/${brand}/${slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.allowed) {
          setStatus(d.status);
          setAllowed(d.allowed);
        }
      })
      .catch(() => {});
  }, [brand, slug]);

  const runDiff = useCallback(async (baseSha: string) => {
    setCompareBase(baseSha);
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
  }, [brand, slug, viewingSha]);

  const transition = useCallback(async (to: string) => {
    setTransitioning(true);
    setStatusError(null);
    try {
      const res = await fetch(`/api/status/${brand}/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusError(data.error || `Transition failed (${res.status})`);
        return;
      }
      window.location.reload();
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : String(e));
    } finally {
      setTransitioning(false);
    }
  }, [brand, slug]);

  return (
    <>
      <div className="panel">
        <div className="panel-head">Approval</div>
        <div className="panel-body">
          <div className="meta-row">
            <span className="meta-key">Current status</span>
            <span className="meta-val">
              <span className="badge" data-status={status}>{status}</span>
            </span>
          </div>
          {allowed.length > 0 ? (
            <div className="approval-actions">
              {allowed.map((next) => (
                <button
                  key={next}
                  className="btn btn-secondary"
                  disabled={transitioning}
                  onClick={() => transition(next)}
                >
                  Move to {next}
                </button>
              ))}
            </div>
          ) : (
            <div className="approval-note">
              No further transitions from <strong>{status}</strong>.
            </div>
          )}
          {statusError && (
            <div className="banner" data-kind="error" style={{ margin: "10px 0 0" }}>
              {statusError}
            </div>
          )}
          <div className="approval-note" style={{ marginTop: 10 }}>
            Sign-off is recorded as commit trailers, so the audit trail lives in
            git rather than a side database.
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span>Version history</span>
          <span style={{ textTransform: "none", letterSpacing: 0 }}>{timeline.length}</span>
        </div>

        {timeline.length === 0 && (
          <div className="panel-body" style={{ color: "var(--ink-faint)", fontSize: 13 }}>
            No commits found for this path.
          </div>
        )}

        <div>
          {timeline.map((t) => {
            const isViewing = viewingSha ? t.sha === viewingSha : t.isCurrent;
            return (
              <div key={t.sha} className="version" data-current={isViewing}>
                <div className="version-head">
                  <span className="version-num">v{t.version}</span>
                  <span className="version-sha">{t.shortSha}</span>
                  {t.isCurrent && (
                    <span className="badge" style={{ marginLeft: "auto" }}>current</span>
                  )}
                </div>
                <div className="version-subject">{t.subject}</div>
                <div className="version-meta">
                  {t.author.name || t.author.login || "unknown"}
                  {t.author.date &&
                    ` · ${new Date(t.author.date).toLocaleDateString("en-AU", {
                      day: "numeric", month: "short", year: "numeric",
                    })}`}
                </div>
                <div className="version-actions">
                  <a
                    className="version-action"
                    href={t.isCurrent ? `/${brand}/${slug}` : `/${brand}/${slug}?v=${t.sha}`}
                  >
                    View
                  </a>
                  <a className="version-action" href={`/api/render/${brand}/${slug}?ref=${t.sha}`} target="_blank" rel="noreferrer">
                    PDF
                  </a>
                  {!t.isCurrent && (
                    <button className="version-action" onClick={() => runDiff(t.sha)}>
                      Compare
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {compareBase && (
        <div className="panel">
          <div className="panel-head">
            <span>Changes since {compareBase.slice(0, 7)}</span>
            <button className="btn btn-secondary" onClick={() => { setCompareBase(null); setDiff(null); }}>
              Close
            </button>
          </div>
          <div className="panel-body">
            {diffing && <div className="approval-note">Comparing…</div>}
            {diffError && <div className="banner" data-kind="error">{diffError}</div>}
            {diff && (
              <>
                <div className="diff-headline">{diff.headline}</div>
                {diff.changes.length === 0 && (
                  <div className="approval-note">These revisions are structurally identical.</div>
                )}
                <div className="diff-list">
                  {diff.changes.map((c, i) => (
                    <div key={i} className="diff-item" data-kind={SEVERITY[c.type] || "edit"}>
                      <span className="diff-tag">{LABEL[c.type] || c.type}</span>
                      <span className="diff-detail">{c.detail}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
