"use client";

import { useCallback, useMemo, useState } from "react";
import type { DiffHunk, DiffRow, UnifiedDiffResult, WordRun } from "@/lib/diff";

/**
 * GitHub-shaped unified diff.
 *
 * The semantic view answers "what changed in document terms". This answers the
 * other question: show me the text, with line numbers and the lines either
 * side, exactly as a pull request does. Both are offered because a reviewer
 * signing off and an author checking their own edit want different things.
 *
 * Layout notes that matter:
 *  - Line numbers sit in fixed-width gutters that do not scroll horizontally
 *    with the content, so a long line never pushes the numbers off screen.
 *  - Rows are a grid, not a table, because a table's column sizing fights the
 *    `white-space: pre-wrap` needed to keep long prose lines readable without
 *    a horizontal scrollbar.
 *  - Word-level marks only appear on lines the differ judged to be the same
 *    line reworded. Below that threshold the marks are confetti.
 */

type ViewMode = "unified" | "split";

/** Renders one line's text, with word-level marks when present. */
function LineText({ text, words }: { text?: string; words?: WordRun[] }) {
  if (words?.length) {
    return (
      <span className="dl-text">
        {words.map((w, i) =>
          w.op === "same" ? (
            <span key={i}>{w.text}</span>
          ) : (
            <mark key={i} className="dl-word" data-op={w.op}>
              {w.text}
            </mark>
          )
        )}
      </span>
    );
  }
  // A zero-width space keeps empty lines at full row height, so a deleted
  // blank line still reads as a row rather than collapsing to nothing.
  return <span className="dl-text">{text ? text : "\u200b"}</span>;
}

/** The +/- marker column, matching GitHub's single-character gutter. */
function Marker({ op }: { op: DiffRow["op"] | "add" | "remove" | "same" }) {
  const ch = op === "add" ? "+" : op === "remove" ? "-" : " ";
  return (
    <span className="dl-marker" aria-hidden="true">
      {ch}
    </span>
  );
}

/**
 * Unified (single-column) rows.
 *
 * A paired rewrite is emitted as a removal row followed by an addition row,
 * each carrying its half of the word marks — which is exactly what GitHub
 * does and what the screenshot shows.
 */
function UnifiedRows({ rows }: { rows: DiffRow[] }) {
  const out: React.ReactElement[] = [];

  rows.forEach((r, i) => {
    if (r.op === "change") {
      out.push(
        <div key={`${i}-r`} className="dl-row" data-op="remove">
          <span className="dl-no dl-no-left">{r.leftNo ?? ""}</span>
          <span className="dl-no dl-no-right" />
          <Marker op="remove" />
          <LineText text={r.leftText} words={r.leftWords} />
        </div>
      );
      out.push(
        <div key={`${i}-a`} className="dl-row" data-op="add">
          <span className="dl-no dl-no-left" />
          <span className="dl-no dl-no-right">{r.rightNo ?? ""}</span>
          <Marker op="add" />
          <LineText text={r.rightText} words={r.rightWords} />
        </div>
      );
      return;
    }

    const text = r.op === "remove" ? r.leftText : r.rightText;
    out.push(
      <div key={i} className="dl-row" data-op={r.op}>
        <span className="dl-no dl-no-left">{r.leftNo ?? ""}</span>
        <span className="dl-no dl-no-right">{r.rightNo ?? ""}</span>
        <Marker op={r.op} />
        <LineText text={text} />
      </div>
    );
  });

  return <>{out}</>;
}

/**
 * Split (side-by-side) rows.
 *
 * Deletions occupy the left pane only and additions the right, with the
 * opposite cell left blank and tinted so the eye tracks the pairing.
 */
function SplitRows({ rows }: { rows: DiffRow[] }) {
  return (
    <>
      {rows.map((r, i) => {
        const leftOp =
          r.op === "add" ? "blank" : r.op === "change" ? "remove" : r.op;
        const rightOp =
          r.op === "remove" ? "blank" : r.op === "change" ? "add" : r.op;

        return (
          <div key={i} className="dl-split-row">
            <span className="dl-no" data-op={leftOp}>
              {r.leftNo ?? ""}
            </span>
            <span className="dl-cell" data-op={leftOp}>
              {leftOp !== "blank" && (
                <>
                  <Marker op={leftOp === "same" ? "same" : "remove"} />
                  <LineText text={r.leftText} words={r.leftWords} />
                </>
              )}
            </span>
            <span className="dl-no" data-op={rightOp}>
              {r.rightNo ?? ""}
            </span>
            <span className="dl-cell" data-op={rightOp}>
              {rightOp !== "blank" && (
                <>
                  <Marker op={rightOp === "same" ? "same" : "add"} />
                  <LineText text={r.rightText} words={r.rightWords} />
                </>
              )}
            </span>
          </div>
        );
      })}
    </>
  );
}

/**
 * The `@@ -a,b +c,d @@` header.
 *
 * GitHub appends the enclosing function; for a document the useful equivalent
 * is the enclosing heading, which the differ supplies.
 */
function HunkHeader({
  hunk,
  hiddenBefore,
  onExpand,
}: {
  hunk: DiffHunk;
  hiddenBefore: number;
  onExpand?: () => void;
}) {
  return (
    <div className="dl-hunk-head">
      {hiddenBefore > 0 && onExpand ? (
        <button
          className="dl-expand"
          onClick={onExpand}
          title={`Show ${hiddenBefore} hidden line${hiddenBefore === 1 ? "" : "s"}`}
        >
          ⌄
        </button>
      ) : (
        <span className="dl-expand" aria-hidden="true" />
      )}
      <span className="dl-hunk-range">
        @@ -{hunk.leftStart},{hunk.leftCount} +{hunk.rightStart},{hunk.rightCount} @@
      </span>
      {hunk.heading && <span className="dl-hunk-context">{hunk.heading}</span>}
    </div>
  );
}

export function UnifiedDiff({
  unified,
  fileLabel,
  onExpandAll,
  expandedAll,
}: {
  unified: UnifiedDiffResult;
  fileLabel: string;
  onExpandAll: () => void;
  expandedAll: boolean;
}) {
  const [mode, setMode] = useState<ViewMode>("unified");
  const [collapsed, setCollapsed] = useState(false);

  /**
   * Locally expanded gaps, keyed by the hunk they precede.
   *
   * Expansion is client-side: the full row list already came down with the
   * response, so revealing context is instant and costs no round trip.
   */
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const expandGap = useCallback((hunkIndex: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(hunkIndex);
      return next;
    });
  }, []);

  /**
   * The diff bar GitHub draws beside the counts: five squares, filled in
   * proportion to how much of the change is additions versus deletions.
   */
  const blocks = useMemo(() => {
    const total = unified.additions + unified.deletions;
    if (total === 0) return [] as ("add" | "remove" | "none")[];
    const addBlocks = Math.round((unified.additions / total) * 5);
    return Array.from({ length: 5 }, (_, i) =>
      i < addBlocks ? ("add" as const) : ("remove" as const)
    );
  }, [unified.additions, unified.deletions]);

  const segments = useMemo(() => {
    const out: { hidden: number; hunkIndex: number; rows: DiffRow[] }[] = [];
    let cursor = 0;

    unified.hunks.forEach((h, i) => {
      const hiddenCount = h.startIndex - cursor;
      const isExpanded = expandedAll || expanded.has(i);
      out.push({
        hidden: isExpanded ? 0 : hiddenCount,
        hunkIndex: i,
        rows: isExpanded
          ? unified.rows.slice(cursor, h.endIndex)
          : h.rows,
      });
      cursor = h.endIndex;
    });

    // Trailing unchanged tail, only shown when everything is expanded.
    if (expandedAll && cursor < unified.rows.length) {
      out.push({ hidden: 0, hunkIndex: -1, rows: unified.rows.slice(cursor) });
    }

    return out;
  }, [unified, expanded, expandedAll]);

  if (unified.hunks.length === 0) {
    return (
      <div className="diff-empty">
        <strong>No line differences.</strong> The two revisions are byte-identical.
      </div>
    );
  }

  return (
    <div className="dl-file">
      <div className="dl-file-head">
        <button
          className="dl-collapse"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand file" : "Collapse file"}
        >
          {collapsed ? "›" : "⌄"}
        </button>
        <span className="dl-path">{fileLabel}</span>

        <span className="dl-stats">
          <span className="dl-add-count">+{unified.additions}</span>
          <span className="dl-del-count">−{unified.deletions}</span>
          <span className="dl-blocks">
            {blocks.map((b, i) => (
              <span key={i} className="dl-block" data-kind={b} />
            ))}
          </span>
        </span>

        <span className="dl-view-toggle">
          <button
            className="dl-toggle-btn"
            data-active={mode === "unified"}
            onClick={() => setMode("unified")}
          >
            Unified
          </button>
          <button
            className="dl-toggle-btn"
            data-active={mode === "split"}
            onClick={() => setMode("split")}
          >
            Split
          </button>
          <button className="dl-toggle-btn" onClick={onExpandAll}>
            {expandedAll ? "Collapse context" : "Expand all"}
          </button>
        </span>
      </div>

      {!collapsed && (
        <div className="dl-body" data-mode={mode}>
          {segments.map((seg, i) => (
            <div key={i}>
              {seg.hunkIndex >= 0 && (
                <HunkHeader
                  hunk={unified.hunks[seg.hunkIndex]}
                  hiddenBefore={seg.hidden}
                  onExpand={() => expandGap(seg.hunkIndex)}
                />
              )}
              {mode === "unified" ? (
                <UnifiedRows rows={seg.rows} />
              ) : (
                <SplitRows rows={seg.rows} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
