"use client";

import { useMemo, useState } from "react";
import { UnifiedDiff } from "@/components/UnifiedDiff";
import { diffUnified } from "@/lib/diff";
import type { RewriteProposal } from "@/components/RewriteBar";

/**
 * Review chrome around a proposed rewrite.
 *
 * The diff rendering itself is UnifiedDiff — the same component Compare uses
 * for revision history — so a rewrite proposal and a saved revision look like
 * the same kind of thing to review, because they are the same kind of thing:
 * a change to the document, pending or already made.
 *
 * This component never touches the buffer. Accept and reject both bubble up
 * to Editor, which owns the single mutation path everything else uses.
 */
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
  onAccept: (finalContent: string, accepted: RewriteProposal) => void;
  onReject: () => void;
}) {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unified = useMemo(
    () => diffUnified(proposal.before, proposal.after, 2),
    [proposal.before, proposal.after]
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
      onAccept(proposal.proposed, proposal);
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

      <UnifiedDiff
        unified={unified}
        fileLabel={`${proposal.model.label} rewrite`}
        onExpandAll={() => {}}
        expandedAll={true}
      />
    </div>
  );
}
