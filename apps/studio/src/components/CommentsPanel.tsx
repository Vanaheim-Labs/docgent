"use client";

import { useRef, useState } from "react";
import type { DocComment } from "@/lib/comments";

export function CommentsPanel({
  comments,
  onResolve,
  onAdd,
  canEdit = false,
  editHref,
}: {
  comments: DocComment[];
  onResolve?: (id: string, resolved: boolean) => void;
  /** Called with the comment body text when the user submits a new comment. */
  onAdd?: (body: string) => void;
  canEdit?: boolean;
  /** If set, shows an "Add in editor" link instead of the inline composer (read-only doc view). */
  editHref?: string;
}) {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const visible = filter === "all" ? comments : comments.filter((c) => !c.resolved);

  function openComposer() {
    setComposing(true);
    setDraft("");
    setTimeout(() => textareaRef.current?.focus(), 40);
  }

  function submitComment() {
    const body = draft.trim();
    if (!body || !onAdd) return;
    onAdd(body);
    setComposing(false);
    setDraft("");
  }

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
        {canEdit && onAdd && !composing && (
          <button className="btn btn-secondary comments-add-btn" onClick={openComposer}>
            + Add
          </button>
        )}
        {!onAdd && editHref && (
          <a className="btn btn-secondary comments-add-btn" href={editHref}>
            + Add
          </a>
        )}
      </div>

      {/* Inline composer — appears at top of list when adding */}
      {composing && (
        <div className="comment-composer">
          <textarea
            ref={textareaRef}
            className="comment-composer-input"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a comment or instruction for agents…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submitComment();
              }
              if (e.key === "Escape") {
                setComposing(false);
                setDraft("");
              }
            }}
          />
          <div className="comment-composer-actions">
            <button
              className="btn btn-secondary"
              onClick={() => { setComposing(false); setDraft(""); }}
            >
              Cancel
            </button>
            <button
              className="btn"
              disabled={!draft.trim()}
              onClick={submitComment}
            >
              Add <kbd>⌘⏎</kbd>
            </button>
          </div>
        </div>
      )}

      {visible.length === 0 && !composing && (
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
