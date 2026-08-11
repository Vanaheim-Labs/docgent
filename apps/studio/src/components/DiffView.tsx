"use client";

import { useMemo, useState } from "react";

export type WordRun = { op: "same" | "add" | "remove"; text: string };

export type Change = {
  type: string;
  detail: string;
  section?: string;
  block?: string;
  key?: string;
  before?: string;
  after?: string;
  words?: WordRun[];
  /** Heading depth either side of a re-level or rename. */
  beforeLevel?: number;
  afterLevel?: number;
};

export type DiffResult = {
  headline: string;
  summary: Record<string, number>;
  changes: Change[];
};

/**
 * Re-levelling is structural bookkeeping, not editorial change. Enabling a
 * table of contents demotes every heading at once, which buried the two or
 * three edits that actually mattered. Collapsed by default.
 */
const NOISE_TYPES = new Set(["section_relevelled"]);

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
  section_renamed: "edit",
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
  section_renamed: "heading",
};

/** Word-level prose diff, removals struck through. */
function WordDiff({ runs }: { runs: WordRun[] }) {
  return (
    <p className="word-diff">
      {runs.map((r, i) =>
        r.op === "same" ? (
          <span key={i}>{r.text} </span>
        ) : (
          <span key={i} className="word-run" data-op={r.op}>
            {r.text}{" "}
          </span>
        )
      )}
    </p>
  );
}

/** Heading depth change stated in words, not hash marks. */
function LevelShift({ from, to }: { from?: number; to?: number }) {
  if (!from || !to || from === to) return null;
  return (
    <span className="diff-level">
      H{from} → H{to}
    </span>
  );
}

/**
 * The body of a single change.
 *
 * Every edit shows both sides. The differ pairs a removal with its matching
 * addition and attaches word runs, so a reworded sentence renders as inline
 * strike/insert rather than as a wholesale replacement. One-sided events are
 * genuine additions or deletions and render as a single tinted block.
 *
 * Prose is not truncated here. A reviewer deciding whether to sign off needs
 * the sentence, and long bodies are capped by CSS with a scroll rather than by
 * cutting the text mid-clause.
 */
function ChangeBody({ change: c }: { change: Change }) {
  const kind = SEVERITY[c.type] || "edit";

  // Paired edit: inline word-level marking.
  if (c.words?.length) {
    return (
      <>
        <LevelShift from={c.beforeLevel} to={c.afterLevel} />
        <WordDiff runs={c.words} />
      </>
    );
  }

  // Metadata and attribute changes carry discrete values either side.
  if (c.before !== undefined && c.after !== undefined) {
    return (
      <p className="diff-detail">
        <span className="diff-side" data-op="remove">{String(c.before)}</span>
        <span className="diff-arrow"> → </span>
        <span className="diff-side" data-op="add">{String(c.after)}</span>
      </p>
    );
  }

  // A removal retains its old value so the reviewer sees what was lost.
  if (c.before !== undefined && c.after === undefined) {
    return (
      <>
        <LevelShift from={c.beforeLevel} to={c.afterLevel} />
        <p className="diff-detail">
          <span className="diff-side" data-op="remove">{String(c.before)}</span>
        </p>
      </>
    );
  }

  if (c.after !== undefined && c.before === undefined) {
    return (
      <>
        <LevelShift from={c.beforeLevel} to={c.afterLevel} />
        <p className="diff-detail">
          <span className="diff-side" data-op="add">{String(c.after)}</span>
        </p>
      </>
    );
  }

  return (
    <>
      <LevelShift from={c.beforeLevel} to={c.afterLevel} />
      <p className="diff-detail" data-kind={kind}>{c.detail}</p>
    </>
  );
}

/**
 * Renders in the main content column, not the sidebar rail.
 *
 * A document diff is document-shaped: paragraphs of prose with words marked
 * up inline. Rendered into a 340px rail it became a tall ribbon roughly six
 * words wide, which no reviewer can read. It takes the wide column and the
 * PDF preview steps aside while a comparison is open.
 */
export function DiffView({
  baseLabel,
  headLabel,
  diff,
  diffing,
  error,
  onClose,
}: {
  baseLabel: string;
  headLabel: string;
  diff: DiffResult | null;
  diffing: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [showNoise, setShowNoise] = useState(false);

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
   * rather than the diff algorithm's walk order. Frontmatter changes carry
   * no section and sort first under their own heading.
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

  const counts = useMemo(() => {
    const c = { added: 0, removed: 0, edited: 0, meta: 0 };
    for (const ch of significant) {
      const kind = SEVERITY[ch.type] || "edit";
      if (kind === "add") c.added++;
      else if (kind === "remove") c.removed++;
      else if (kind === "meta") c.meta++;
      else c.edited++;
    }
    return c;
  }, [significant]);

  return (
    <div className="panel diff-panel">
      <div className="panel-head">
        <span>
          Comparing <strong>{baseLabel}</strong> → <strong>{headLabel}</strong>
        </span>
        <button className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="panel-body diff-body">
        {diffing && <div className="approval-note">Comparing revisions…</div>}
        {error && <div className="banner" data-kind="error">{error}</div>}

        {diff && !diffing && (
          <>
            <div className="diff-summary">
              <div className="diff-headline">{diff.headline}</div>
              <div className="diff-chips">
                {counts.added > 0 && (
                  <span className="diff-chip" data-kind="add">{counts.added} added</span>
                )}
                {counts.removed > 0 && (
                  <span className="diff-chip" data-kind="remove">{counts.removed} removed</span>
                )}
                {counts.edited > 0 && (
                  <span className="diff-chip" data-kind="edit">{counts.edited} edited</span>
                )}
                {counts.meta > 0 && (
                  <span className="diff-chip" data-kind="meta">{counts.meta} values</span>
                )}
                {noise.length > 0 && (
                  <span className="diff-chip" data-kind="quiet">
                    {noise.length} structural
                  </span>
                )}
              </div>
            </div>

            {diff.changes.length === 0 && (
              <div className="diff-empty">
                <strong>No differences.</strong> These revisions are structurally
                identical — no headings, blocks, values or prose differ.
              </div>
            )}

            {significant.length === 0 && noise.length > 0 && (
              <div className="diff-empty">
                <strong>No editorial changes.</strong> The only differences are
                heading levels, shown below.
              </div>
            )}

            {grouped.map(([section, items]) => (
              <section key={section} className="diff-group">
                <h3 className="diff-group-head">{section || "Document metadata"}</h3>
                {items.map((c, i) => (
                  <div key={i} className="diff-change" data-kind={SEVERITY[c.type] || "edit"}>
                    <div className="diff-change-head">
                      <span className="diff-tag">{LABEL[c.type] || c.type}</span>
                      {c.block && <span className="diff-where">{c.block}</span>}
                    </div>
                    <ChangeBody change={c} />
                  </div>
                ))}
              </section>
            ))}

            {noise.length > 0 && (
              <div className="diff-noise">
                <button className="btn btn-secondary" onClick={() => setShowNoise((v) => !v)}>
                  {showNoise ? "Hide" : "Show"} {noise.length} structural change
                  {noise.length === 1 ? "" : "s"}
                </button>
                <p className="approval-note" style={{ marginTop: 8 }}>
                  Heading levels shifted by a table-of-contents or template change.
                  No content was added or removed.
                </p>
                {showNoise && (
                  <div style={{ marginTop: 10 }}>
                    {noise.map((c, i) => (
                      <div key={i} className="diff-change" data-kind="meta">
                        <p className="diff-detail">{c.detail}</p>
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
  );
}
