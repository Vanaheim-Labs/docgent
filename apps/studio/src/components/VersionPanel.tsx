"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimelineEntry } from "@/lib/store";

type WordRun = { op: "same" | "add" | "remove"; text: string };

type Change = {
  type: string;
  detail: string;
  section?: string;
  block?: string;
  key?: string;
  before?: string;
  after?: string;
  words?: WordRun[];
};

/**
 * Re-levelling is structural bookkeeping, not editorial change. Enabling a
 * table of contents demotes every heading at once, which buried the two or
 * three edits that actually mattered. These are collapsed by default.
 */
const NOISE_TYPES = new Set(["section_relevelled"]);

type DiffResult = {
  headline: string;
  summary: Record<string, number>;
  changes: Change[];
};

/** Renders a word-level prose diff inline, struck-through for removals. */
function WordDiff({ runs }: { runs: WordRun[] }) {
  return (
    <span className="word-diff">
      {runs.map((r, i) =>
        r.op === "same" ? (
          <span key={i}>{r.text} </span>
        ) : (
          <span key={i} className="word-run" data-op={r.op}>
            {r.text}{" "}
          </span>
        )
      )}
    </span>
  );
}

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
  section_relevelled: "meta",
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
  section_relevelled: "re-level",
};

export function VersionPanel({
  brand,
  slug,
  timeline,
  currentStatus,
  viewingSha,
  docVersion,
}: {
  brand: string;
  slug: string;
  timeline: TimelineEntry[];
  currentStatus: string;
  viewingSha?: string;
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
  const [compareBase, setCompareBase] = useState<string | null>(null);
  const [compareLabel, setCompareLabel] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffing, setDiffing] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [showNoise, setShowNoise] = useState(false);

  /**
   * The diff panel renders below the revision list inside a scrolling sidebar,
   * so on any realistic history it lands off-screen. Clicking Compare then
   * looked like it did nothing at all. Pull it into view once it exists.
   */
  const diffRef = useRef<HTMLDivElement | null>(null);

  const [status, setStatus] = useState(currentStatus);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [transitioning, setTransitioning] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!compareBase) return;
    diffRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [compareBase, diffing]);

  const runDiff = useCallback(async (baseSha: string, revision?: number) => {
    setCompareBase(baseSha);
    setCompareLabel(revision ? `r${revision}` : baseSha.slice(0, 7));
    setShowNoise(false);
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

  const significant = useMemo(
    () => (diff?.changes ?? []).filter((c) => !NOISE_TYPES.has(c.type)),
    [diff]
  );
  const noise = useMemo(
    () => (diff?.changes ?? []).filter((c) => NOISE_TYPES.has(c.type)),
    [diff]
  );

  /**
   * Grouped by section so a reviewer reads the document in its own order
   * rather than scanning a flat list ordered by the diff algorithm's walk.
   * Frontmatter changes carry no section and sort first under their own head.
   */
  const grouped = useMemo(() => {
    const map = new Map<string, Change[]>();
    for (const c of significant) {
      const key = c.section ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return [...map.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : 0));
  }, [significant]);

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
          <span>Revision history</span>
          <span style={{ textTransform: "none", letterSpacing: 0 }}>
            {timeline.length} {timeline.length === 1 ? "revision" : "revisions"}
          </span>
        </div>

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
                    <button className="version-action" onClick={() => runDiff(t.sha, t.version)}>
                      Compare
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

      {compareBase && (
        <div className="panel" ref={diffRef}>
          <div className="panel-head">
            <span>{compareLabel ?? compareBase.slice(0, 7)} → {viewingSha ? viewingSha.slice(0, 7) : "current"}</span>
            <button
              className="btn btn-secondary"
              onClick={() => { setCompareBase(null); setCompareLabel(null); setDiff(null); setDiffError(null); }}
            >
              Close
            </button>
          </div>
          <div className="panel-body">
            {diffing && <div className="approval-note">Comparing…</div>}
            {diffError && <div className="banner" data-kind="error">{diffError}</div>}
            {diff && !diffing && (
              <>
                <div className="diff-headline">{diff.headline}</div>

                {diff.changes.length === 0 && (
                  <div className="approval-note">
                    These revisions are structurally identical — no headings, blocks,
                    values or prose differ.
                  </div>
                )}

                {significant.length === 0 && noise.length > 0 && (
                  <div className="approval-note" style={{ marginBottom: 10 }}>
                    No editorial changes. The only differences are structural.
                  </div>
                )}

                {grouped.map(([section, items]) => (
                  <div key={section} className="diff-group">
                    <div className="diff-group-head">{section || "Document metadata"}</div>
                    <div className="diff-list">
                      {items.map((c, i) => (
                        <div key={i} className="diff-item" data-kind={SEVERITY[c.type] || "edit"}>
                          <span className="diff-tag">{LABEL[c.type] || c.type}</span>
                          <span className="diff-detail">
                            {c.words?.length ? <WordDiff runs={c.words} /> : c.detail}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {noise.length > 0 && (
                  <div className="diff-noise">
                    <button
                      className="btn btn-secondary"
                      onClick={() => setShowNoise((v) => !v)}
                    >
                      {showNoise ? "Hide" : "Show"} {noise.length} structural change
                      {noise.length === 1 ? "" : "s"}
                    </button>
                    <div className="approval-note" style={{ marginTop: 6 }}>
                      Heading levels shifted by a table-of-contents or template change.
                      No content was added or removed.
                    </div>
                    {showNoise && (
                      <div className="diff-list" style={{ marginTop: 8 }}>
                        {noise.map((c, i) => (
                          <div key={i} className="diff-item" data-kind="meta">
                            <span className="diff-tag">{LABEL[c.type] || c.type}</span>
                            <span className="diff-detail">{c.detail}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
