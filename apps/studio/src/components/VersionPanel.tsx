"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import type { TimelineEntry } from "@/lib/store";

/**
 * Conventional-commit boilerplate stripped for display.
 *
 * Every revision subject reads `docs(inkl/shareholder-update-fy26): Shareholder
 * Update FY26` — the type and scope repeat the brand and slug already shown by
 * the surrounding page, leaving the meaningful part buried at the end of a long
 * monospace line.
 *
 * The full subject stays on the element's `title`, and the commit hash remains
 * on the row, because HANDOVER.md makes git the audit record: this trims what
 * is displayed, never what is recoverable.
 */
function displaySubject(subject: string): string {
  const m = subject.match(/^[a-z]+(?:\([^)]*\))?!?:\s*(.+)$/);
  return (m ? m[1] : subject).trim() || subject;
}

/**
 * One frame in the filmstrip.
 *
 * Lazy: only requests a thumbnail once scrolled near, since each miss costs
 * a real render-worker round trip (pandoc + WeasyPrint + pdftoppm). Once
 * loaded the URL is cached by the browser under the same immutable
 * Cache-Control the API sets for historical refs, so re-mounting the panel
 * never re-fetches.
 */
const WORKFLOW_STATES = ["draft", "review", "approved", "released"] as const;

function WorkflowStepper({ current }: { current: string }) {
  const currentIdx = WORKFLOW_STATES.indexOf(current as typeof WORKFLOW_STATES[number]);
  return (
    <div className="workflow-steps" aria-label="Approval workflow">
      {WORKFLOW_STATES.map((state, idx) => {
        const isDone = currentIdx > idx;
        const isActive = currentIdx === idx;
        return (
          <Fragment key={state}>
            {idx > 0 && <span className="workflow-step-arrow" aria-hidden="true">›</span>}
            <span
              className="workflow-step"
              data-active={isActive}
              data-done={isDone}
              aria-current={isActive ? "step" : undefined}
            >
              <span className="workflow-step-dot" />
              {state}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

function FilmstripFrame({
  brand,
  slug,
  sha,
  version,
  subject,
  isCurrent,
  active,
  onSelect,
  diffStat,
}: {
  brand: string;
  slug: string;
  sha: string;
  version: number;
  subject: string;
  isCurrent: boolean;
  active: boolean;
  onSelect: () => void;
  diffStat?: { add: number; del: number };
}) {
  const [visible, setVisible] = useState(false);
  const [errored, setErrored] = useState(false);
  const ref = useCallback((node: HTMLButtonElement | null) => {
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    obs.observe(node);
  }, []);

  const src = isCurrent
    ? `/api/thumbnail/${brand}/${slug}`
    : `/api/thumbnail/${brand}/${slug}?ref=${sha}`;

  return (
    <button
      ref={ref}
      type="button"
      className="filmstrip-frame"
      data-active={active}
      onClick={onSelect}
      title={`r${version}${diffStat ? ` · +${diffStat.add}/−${diffStat.del}` : ""} — ${subject.slice(0, 60)}`}
    >
      {visible && !errored ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`Revision ${version} thumbnail`}
          loading="lazy"
          onError={() => setErrored(true)}
        />
      ) : (
        <div className="filmstrip-frame-placeholder">
          {errored ? "—" : "r" + version}
        </div>
      )}
      {diffStat && (diffStat.add > 0 || diffStat.del > 0) && (
        <span className="filmstrip-diff-stat">
          {diffStat.add > 0 && <span data-op="add">+{diffStat.add}</span>}
          {diffStat.del > 0 && <span data-op="del">−{diffStat.del}</span>}
        </span>
      )}
      <span className="filmstrip-frame-label">r{version}</span>
    </button>
  );
}

export function VersionPanel({
  brand,
  slug,
  timeline,
  currentStatus,
  viewingSha,
  docVersion,
  onCompare,
  comparingSha,
}: {
  brand: string;
  slug: string;
  timeline: TimelineEntry[];
  currentStatus: string;
  viewingSha?: string;
  /**
   * Comparison is owned by the parent so the diff can render in the main
   * column. A document diff needs the wide pane: in this 340px rail a
   * paragraph of prose collapsed into an unreadable ribbon.
   */
  onCompare: (baseSha: string, revision?: number) => void;
  comparingSha?: string | null;
  /**
   * The `version:` value from the document's own frontmatter.
   *
   * Deliberately distinct from `TimelineEntry.version`, which is a count of
   * commits touching the path. The two are independent: an author can bump
   * (or, via a restore, roll back) the frontmatter version without any
   * relationship to how many revisions exist. Showing a revision count
   * prefixed with "v" made them look like the same number and produced a
   * document whose cover read v14 next to a panel reading v11.
   */
  docVersion?: string;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [transitioning, setTransitioning] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [diffStats, setDiffStats] = useState<Record<string, { add: number; del: number }>>({});

  useEffect(() => {
    if (timeline.length < 2) return;
    const pairs = timeline.slice(0, 7);
    for (let i = 0; i < pairs.length - 1; i++) {
      const head = pairs[i].sha;
      const base = pairs[i + 1].sha;
      fetch(`/api/diff/${brand}/${slug}?base=${base}&head=${head}&context=0`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.unified) {
            setDiffStats((prev) => ({
              ...prev,
              [head]: { add: data.unified.additions, del: data.unified.deletions },
            }));
          }
        })
        .catch(() => {});
    }
  }, [brand, slug, timeline]);

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

  /**
   * Forward revert: writes the chosen revision back as a new commit.
   * Confirmation is warranted because this lands on the timeline immediately
   * rather than opening in the editor first.
   */
  const restore = useCallback(async (sha: string, revision: number) => {
    if (!window.confirm(
      `Restore revision ${revision} (${sha.slice(0, 7)})?\n\n` +
      "This writes its content back as a new revision on top of the current one. " +
      "Nothing in the history is rewritten.\n\n" +
      "Note: this also restores that revision's frontmatter version, which may " +
      "move the document version backwards."
    )) return;

    setRestoring(sha);
    setRestoreError(null);
    try {
      const res = await fetch(`/api/restore/${brand}/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: sha }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRestoreError(data.message || data.error || `Restore failed (${res.status})`);
        return;
      }
      window.location.href = `/${brand}/${slug}`;
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(null);
    }
  }, [brand, slug]);

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
          <WorkflowStepper current={status} />
          <div className="meta-row">
            <span className="meta-key">Current status</span>
            <span className="meta-val">
              <span className="badge" data-status={status}>{status}</span>
            </span>
          </div>
          {allowed.length > 0 ? (
            <>
              <div className="approval-actions">
                {allowed.map((next) => (
                  <button
                    key={next}
                    className="btn btn-secondary"
                    disabled={transitioning}
                    onClick={() => transition(next)}
                  >
                    → Move to {next}
                  </button>
                ))}
              </div>
              <div className="approval-note" style={{ marginTop: 6 }}>
                Changes will be committed immediately.
              </div>
            </>
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
          <details className="workflow-disclosure">
            <summary>How does approval work?</summary>
            <p>
              Sign-off is recorded as commit trailers, so the audit trail lives in
              git rather than a side database.
            </p>
          </details>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span>Revision history</span>
          <span style={{ textTransform: "none", letterSpacing: 0 }}>
            {timeline.length} {timeline.length === 1 ? "revision" : "revisions"}
          </span>
        </div>

        {timeline.length > 0 && (
          <div className="filmstrip" role="list" aria-label="Version filmstrip">
            {timeline.map((t) => {
              const isViewing = viewingSha ? t.sha === viewingSha : t.isCurrent;
              return (
                <FilmstripFrame
                  key={t.sha}
                  brand={brand}
                  slug={slug}
                  sha={t.sha}
                  version={t.version}
                  subject={t.subject}
                  isCurrent={t.isCurrent}
                  active={isViewing}
                  diffStat={diffStats[t.sha]}
                  onSelect={() =>
                    (window.location.href = t.isCurrent
                      ? `/${brand}/${slug}`
                      : `/${brand}/${slug}?v=${t.sha}`)
                  }
                />
              );
            })}
          </div>
        )}

        {docVersion && (
          <div className="panel-body" style={{ paddingBottom: 0 }}>
            <div className="meta-row">
              <span className="meta-key">Document version</span>
              <span className="meta-val">{docVersion}</span>
            </div>
            <div className="approval-note" style={{ marginTop: 6 }}>
              Set by <code>version:</code> in the document&rsquo;s frontmatter. Independent
              of the revision count below, which counts commits.
            </div>
          </div>
        )}

        {restoreError && (
          <div className="panel-body" style={{ paddingBottom: 0 }}>
            <div className="banner" data-kind="error">{restoreError}</div>
          </div>
        )}

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
                  <span className="version-num">r{t.version}</span>
                  <span className="version-sha">{t.shortSha}</span>
                  {t.isCurrent && (
                    <span className="badge" style={{ marginLeft: "auto" }}>current</span>
                  )}
                </div>
                <div className="version-subject" title={t.subject}>
                  {displaySubject(t.subject)}
                </div>
                <div className="version-meta">
                  {(t.author.email?.includes("[bot]") || /\bbot\b/i.test(t.author.name || "") || t.author.name === "Docgent Studio") ? "🤖 " : ""}
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
                    <button
                      className="version-action"
                      data-active={comparingSha === t.sha}
                      onClick={() => onCompare(t.sha, t.version)}
                    >
                      {comparingSha === t.sha ? "Comparing" : "Compare"}
                    </button>
                  )}
                  {!t.isCurrent && (
                    <button
                      className="version-action"
                      disabled={restoring !== null}
                      onClick={() => restore(t.sha, t.version)}
                    >
                      {restoring === t.sha ? "Restoring…" : "Restore"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </>
  );
}
