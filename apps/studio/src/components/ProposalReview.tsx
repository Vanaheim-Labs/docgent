"use client";

import { useMemo, useState } from "react";
import { UnifiedDiff } from "@/components/UnifiedDiff";
import { diffDocuments, diffHeadline, diffUnified } from "@/lib/diff";
import type { Change } from "@/lib/diff";
import type { RewriteProposal } from "@/components/RewriteBar";

/**
 * Review chrome around a proposed rewrite.
 *
 * Two readings of the same change, exactly as Compare already offers them:
 * Source diff (line-level, GitHub-shaped) and Change summary (document-level
 * — "what actually changed", grouped by section, prose reworded shown as
 * inline strike/insert). Andrew asked for the second explicitly: reviewing a
 * rewrite by scanning a red/green line diff is the wrong reading for prose,
 * which is exactly the argument Compare already made for revision history.
 * A pending proposal and an already-saved revision are the same kind of
 * thing to review, so they get the same view.
 *
 * This component never touches the buffer. Accept and reject both bubble up
 * to Editor, which owns the single mutation path everything else uses.
 */

type Tab = "source" | "summary";

/** Re-levelling is structural bookkeeping, not editorial change — same
 *  exclusion Compare applies, so a rewrite that only shifts heading depth
 *  does not read as noisier than one that actually changed prose. */
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

function WordDiff({ runs }: { runs: NonNullable<Change["words"]> }) {
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

function LevelShift({ from, to }: { from?: number; to?: number }) {
  if (!from || !to || from === to) return null;
  return (
    <span className="diff-level">
      H{from} → H{to}
    </span>
  );
}

function ChangeBody({ change: c }: { change: Change }) {
  const kind = SEVERITY[c.type] || "edit";

  if (c.words?.length) {
    return (
      <>
        <LevelShift from={c.beforeLevel} to={c.afterLevel} />
        <WordDiff runs={c.words} />
      </>
    );
  }

  if (c.before !== undefined && c.after !== undefined) {
    return (
      <p className="diff-detail">
        <span className="diff-side" data-op="remove">{String(c.before)}</span>
        <span className="diff-arrow"> → </span>
        <span className="diff-side" data-op="add">{String(c.after)}</span>
      </p>
    );
  }

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

/** Semantic Change summary — grouped by section, in document order. */
function ChangeSummary({ changes }: { changes: Change[] }) {
  const significant = useMemo(() => changes.filter((c) => !NOISE_TYPES.has(c.type)), [changes]);
  const noise = useMemo(() => changes.filter((c) => NOISE_TYPES.has(c.type)), [changes]);
  const [showNoise, setShowNoise] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, Change[]>();
    for (const c of significant) {
      const key = c.section ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return [...map.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : 0));
  }, [significant]);

  if (changes.length === 0) {
    return (
      <div className="diff-empty">
        <strong>No differences.</strong> The rewrite produced text identical to the original.
      </div>
    );
  }

  if (significant.length === 0 && noise.length > 0) {
    return (
      <div className="diff-empty">
        <strong>No editorial changes.</strong> The only differences are heading levels.
      </div>
    );
  }

  return (
    <>
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
  );
}

export function ProposalReview({
  proposal,
  brand,
  slug,
  onAccept,
  onReject,
}: {
  proposal: RewriteProposal;
  brand: string;
  slug: string;
  onAccept: (finalContent: string, accepted: RewriteProposal, newSha: string | null) => void;
  onReject: () => void;
}) {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Summary first: reviewing a rewrite is a document-level judgement call
  // ("did this say what I asked for"), not a line-level audit — the source
  // view stays one click away for whoever wants to check exact wording.
  const [tab, setTab] = useState<Tab>("summary");

  const unified = useMemo(
    () => diffUnified(proposal.before, proposal.after, 2),
    [proposal.before, proposal.after]
  );
  const semantic = useMemo(
    () => diffDocuments(proposal.before, proposal.after),
    [proposal.before, proposal.after]
  );
  const headline = useMemo(() => diffHeadline(semantic), [semantic]);
  const significantCount = useMemo(
    () => semantic.changes.filter((c) => !NOISE_TYPES.has(c.type)).length,
    [semantic]
  );

  const accept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const res = await fetch(`/api/rewrite/${brand}/${slug}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: proposal.proposed,
          baseSha: proposal.baseSha,
          instruction: proposal.instruction,
          model: proposal.model.id,
          scopeLabel:
            "kind" in (proposal.scope as object) &&
            (proposal.scope as { kind: string }).kind === "section"
              ? (proposal.scope as { heading?: string }).heading
              : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "stale") {
          setError(
            data.message ||
              "The document changed since this rewrite was proposed. Reject it and try again."
          );
        } else {
          setError(data.error || `Could not save (${res.status}).`);
        }
        return;
      }
      onAccept(proposal.proposed, proposal, data.sha ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="proposal-review">
      <div className="proposal-review-head">
        <div>
          <div className="proposal-review-instruction">“{proposal.instruction}”</div>
          <div className="proposal-review-meta">
            {proposal.model.label}
            {proposal.diagnostics.length > 0 && (
              <span className="diag-pill" data-severity="error" style={{ marginLeft: 8 }}>
                {proposal.diagnostics.length} validation error
                {proposal.diagnostics.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        <div className="proposal-review-actions">
          <button className="btn btn-secondary" onClick={onReject} disabled={accepting}>
            Reject
          </button>
          <button
            className="btn"
            onClick={accept}
            disabled={accepting || !proposal.valid}
            title={!proposal.valid ? "Fix the validation errors before accepting" : undefined}
          >
            {accepting ? "Accepting…" : "Accept"}
          </button>
        </div>
      </div>

      {proposal.diagnostics.length > 0 && (
        <div className="diagnostics" style={{ margin: "0 0 12px" }}>
          {proposal.diagnostics.map((d, i) => (
            <div key={i} className="diagnostic" data-severity={d.severity}>
              <span className="diagnostic-line">L{d.line}</span>
              <span>{d.message}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="banner" data-kind="error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="diff-tabs">
        <button
          className="diff-tab"
          data-active={tab === "summary"}
          onClick={() => setTab("summary")}
        >
          Change summary{significantCount > 0 ? ` (${significantCount})` : ""}
        </button>
        <button
          className="diff-tab"
          data-active={tab === "source"}
          onClick={() => setTab("source")}
        >
          Source diff <span className="dl-add-count">+{unified.additions}</span>{" "}
          <span className="dl-del-count">−{unified.deletions}</span>
        </button>
      </div>

      <div className="diff-summary">
        <div className="diff-headline">{headline}</div>
      </div>

      {tab === "summary" ? (
        <ChangeSummary changes={semantic.changes} />
      ) : (
        <UnifiedDiff
          unified={unified}
          fileLabel={`${proposal.model.label} rewrite`}
          onExpandAll={() => {}}
          expandedAll={true}
        />
      )}
    </div>
  );
}
