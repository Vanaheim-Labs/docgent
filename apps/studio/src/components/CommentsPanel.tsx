"use client";

import { useState } from "react";
import type { DocComment } from "@/lib/comments";

export function CommentsPanel({
  comments,
  onResolve,
  onAdd,
  canEdit = false,
}: {
  comments: DocComment[];
  onResolve?: (id: string, resolved: boolean) => void;
  onAdd?: () => void;
  canEdit?: boolean;
}) {
  const [filter, setFilter] = useState<"open" | "all">("open");

  const visible = filter === "all" ? comments : comments.filter((c) => !c.resolved);

  return (
    <div className="comments-panel">
      <div className="comments-panel-head">
        <div className="comments-filter-tabs">
          <button
            className="comments-filter-tab"
            data-active={filter === "open"}
            onClick={() => setFilter("open")}
          >
            Open
          </button>
          <button
            className="comments-filter-tab"
            data-active={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All
          </button>
        </div>
        {canEdit && onAdd && (
          <button className="btn btn-secondary comments-add-btn" onClick={onAdd}>
            + Add
          </button>
        )}
      </div>

      {visible.length === 0 && (
        <div className="comments-empty">
          {filter === "open" ? "No open comments." : "No comments yet."}
        </div>
      )}

      <div className="comments-list">
        {visible.map((c) => (
          <div key={c.id} className="comment-card" data-resolved={c.resolved}>
            <div className="comment-card-head">
              <span className="comment-author">{c.author}</span>
              <span className="comment-line-ref">Line {c.line}</span>
            </div>
            <div className="comment-body">{c.body}</div>
            <div className="comment-card-foot">
              {onResolve && (
                <button
                  className="comment-resolve-btn"
                  onClick={() => onResolve(c.id, !c.resolved)}
                >
                  {c.resolved ? "↩ Unresolve" : "✓ Resolve"}
                </button>
              )}
              {c.resolved && (
                <span className="comment-resolved-badge">Resolved</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
