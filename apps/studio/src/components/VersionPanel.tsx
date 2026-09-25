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

/** Group consecutive commits by the same author within a 2-hour window. */
type TimelineGroup = {
  key: string;
  entries: TimelineEntry[];
};

function groupTimeline(entries: TimelineEntry[]): TimelineGroup[] {
  if (entries.length === 0) return [];
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const groups: TimelineGroup[] = [];

  for (const entry of entries) {
    const last = groups[groups.length - 1];
    const lastEntry = last?.entries[last.entries.length - 1];
    const sameAuthor =
      last &&
      lastEntry &&
      (entry.author.name || "") === (lastEntry.author.name || "") &&
      (entry.author.email || "") === (lastEntry.author.email || "");

    const withinWindow =
      last &&
      lastEntry &&
      lastEntry.author.date &&
      entry.author.date &&
      Math.abs(
        new Date(lastEntry.author.date).getTime() -
          new Date(entry.author.date).getTime()
      ) <= TWO_HOURS_MS;

    if (sameAuthor && withinWindow) {
      last.entries.push(entry);
    } else {
      groups.push({ key: entry.sha, entries: [entry] });
    }
  }
  return groups;
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
  viewingSha,
  docVersion,
  onCompare,
  comparingSha,
  baseSha,
  onView,
}: {
  brand: string;
  slug: string;
  timeline: TimelineEntry[];
  viewingSha?: string;
  onCompare: (baseSha: string, revision?: number) => void;
  comparingSha?: string | null;
  docVersion?: string;
  baseSha?: string;
  onView?: (sha?: string) => void;
}) {
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [diffStats, setDiffStats] = useState<Record<string, { add: number; del: number }>>({}); 
  // Track which timeline groups are expanded (show all entries)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

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

  /**
   * Forward revert: writes the chosen revision back as a new commit.
   * Confirmation is warranted because this lands on the timeline immediately
   * rather than opening in the editor first.
   */
  const restore = useCallback(async (sha: string, revision: number) => {
    if (!baseSha) return;
    if (!window.confirm(
      `Restore revision ${revision} (${sha.slice(0, 7)})?\n\n` +
      "This writes its content back as a new revision on top of the current one. " +
      "Nothing in the history is rewritten.\n\n" +
      "The document version will advance. Lifecycle status does not prevent restoring."
    )) return;

    setRestoring(sha);
    setRestoreError(null);
    try {
      const res = await fetch(`/api/restore/${brand}/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: sha, baseSha }),
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
  }, [brand, slug, baseSha]);

  return (
    <>
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
                    onView ? onView(t.isCurrent ? undefined : t.sha) : (window.location.href = t.isCurrent
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
          {groupTimeline(timeline).map((group) => {
            const isExpanded = expandedGroups.has(group.key);
            const entriesToShow =
              group.entries.length === 1 || isExpanded
                ? group.entries
                : [group.entries[0]];
            const hiddenCount = group.entries.length - 1;
            const groupAuthor = group.entries[0].author;
            const isGroupAgent =
              groupAuthor.email?.includes("[bot]") ||
              /\bbot\b/i.test(groupAuthor.name || "") ||
              groupAuthor.name === "Docgent Studio";

            return (
              <Fragment key={group.key}>
                {group.entries.length > 1 && (
                  <div className="version-group-head">
                    <span>
                      {isGroupAgent ? "🤖 " : ""}
                      {groupAuthor.name || groupAuthor.login || "unknown"}
                      {groupAuthor.date &&
                        ` · ${new Date(groupAuthor.date).toLocaleDateString("en-AU", {
                          day: "numeric", month: "long",
                        })}`}
                      {" "}— {group.entries.length} operations
                    </span>
                    <button
                      className="version-group-toggle"
                      onClick={() =>
                        setExpandedGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.key)) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        })
                      }
                    >
                      {isExpanded ? "▴ Collapse" : `▾ Show ${hiddenCount} more`}
                    </button>
                  </div>
                )}
                {entriesToShow.map((t) => {
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
                          onClick={onView ? (event) => { event.preventDefault(); onView(t.isCurrent ? undefined : t.sha); } : undefined}
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
                            disabled={restoring !== null || !baseSha}
                            title={!baseSha ? "Return to the current document before restoring." : undefined}
                            onClick={() => restore(t.sha, t.version)}
                          >
                            {restoring === t.sha ? "Restoring…" : "Restore"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
      </div>
    </>
  );
}
