import { useState } from "react";
import Link from "next/link";
import type { DocSummary } from "@/lib/store";

/** Strip conventional-commit prefix and return the meaningful part, max 60 chars. */
function stripConventionalPrefix(subject: string): string {
  const m = subject.match(/^[a-z]+(?:\([^)]*\))?!?:\s*(.+)$/);
  const stripped = (m ? m[1] : subject).trim() || subject;
  return stripped.length > 60 ? stripped.slice(0, 60) + "…" : stripped;
}

/**
 * Where a document sits in the review cycle, derived from frontmatter status
 * plus who touched it last.
 *
 * "review" alone is ambiguous — it could mean an agent just finished a pass
 * and it is waiting on a human, or a human just finished marking it up and
 * it is waiting on an agent. The two need different verbs in the UI, so the
 * queue bucket folds in lastCommit.isAgent to tell them apart. Everything
 * else about the lifecycle (draft/review/approved/released/superseded)
 * still comes from the vocabulary registry's status enum — this only adds
 * the "who's turn is it" reading on top.
 */
export type QueueBucket = "needs-review" | "in-progress" | "done";

export function queueBucket(doc: DocSummary): QueueBucket {
  const status = (doc.frontmatter?.status || "draft").toLowerCase();
  if (status === "released" || status === "superseded") return "done";
  if (status === "approved") return "in-progress";
  // draft or review: an agent-authored last commit means it is fresh work
  // sitting in front of a human; anything else means a human is mid-edit or
  // it has not been touched since it was created.
  if (doc.lastCommit?.isAgent) return "needs-review";
  if (status === "review") return "needs-review";
  return "in-progress";
}

export const BUCKET_LABEL: Record<QueueBucket, string> = {
  "needs-review": "Needs review",
  "in-progress": "In progress",
  done: "Done",
};

/** `strategic-report` reads as `Strategic report` to a human. */
function label(v: string) {
  const s = String(v).replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function timeAgo(ms: number | null | undefined): string | null {
  if (!ms) return null;
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/** Derive a human-readable action description from the document state. */
function actionText(doc: DocSummary, bucket: QueueBucket): string | null {
  const status = (doc.frontmatter?.status || "draft").toLowerCase();
  const isAgent = doc.lastCommit?.isAgent;
  const subject = doc.lastCommit?.subject;
  const when = timeAgo(doc.lastCommit?.at);

  if (bucket === "needs-review" && isAgent && subject) {
    const action = stripConventionalPrefix(subject);
    return when ? `Agent finished ${when} — ${action}` : action;
  }
  if (bucket === "needs-review" && status === "review") {
    return when ? `Submitted for review ${when}` : "Awaiting review";
  }
  if (bucket === "in-progress" && isAgent && subject) {
    return `Agent working — ${stripConventionalPrefix(subject)}`;
  }
  if (bucket === "in-progress" && !isAgent) {
    const name = doc.lastCommit?.name;
    return name ? `${name} editing${when ? ` · ${when}` : ""}` : "Human editing";
  }
  if (bucket === "done") {
    return status === "released" ? "Released" : "Approved";
  }
  return null;
}

/** Call-to-action label for the right rail, shown only for needs-review. */
function ctaLabel(bucket: QueueBucket): string | null {
  if (bucket === "needs-review") return "Review →";
  return null;
}

/**
 * One row in the work queue.
 *
 * A row, not a card: the question the library page answers is "what needs my
 * attention", and a list of short rows lets someone scan twenty documents in
 * the time a grid of cards would take to scroll through five. The card
 * layout survives nowhere now — density is the point of this view.
 */
export function QueueRow({ doc }: { doc: DocSummary }) {
  const fm = doc.frontmatter || {};
  const status = fm.status?.trim();
  const who = doc.lastCommit?.name;
  const when = timeAgo(doc.lastCommit?.at);
  const isAgent = doc.lastCommit?.isAgent;
  const bucket = queueBucket(doc);
  const action = actionText(doc, bucket);
  const cta = ctaLabel(bucket);
  const [thumbErrored, setThumbErrored] = useState(false);

  return (
    <Link href={`/${doc.brand}/${doc.slug}`} className="queue-row">
      <span className="queue-row-thumb">
        {!thumbErrored && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/thumbnail/${doc.brand}/${doc.slug}`}
            alt={`Thumbnail for ${doc.title}`}
            loading="lazy"
            onError={() => setThumbErrored(true)}
          />
        )}
      </span>
      <span className="queue-row-status" data-status={status?.toLowerCase()} aria-hidden="true" />
      <span className="queue-row-main">
        <span className="queue-row-title" title={doc.title}>
          {doc.title}
          {doc.renderError && (
            <span className="queue-row-render-error" title={doc.renderError}>⚠ render failed</span>
          )}
        </span>
        {action ? (
          <span className="queue-row-sub">{action}</span>
        ) : fm.subtitle ? (
          <span className="queue-row-sub">{String(fm.subtitle)}</span>
        ) : null}
        {(doc.brandName || fm.doctype) && (
          <span className="queue-row-meta">
            {[doc.brandName, fm.doctype ? label(fm.doctype) : null].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
      {status && (
        <span className="badge" data-status={status.toLowerCase()}>
          {label(status)}
        </span>
      )}
      <span className="queue-row-touched">
        {action ? null : who ? (
          <>
            <span className={isAgent ? "queue-row-agent" : undefined}>
              {isAgent ? "🤖 " : ""}{who}
            </span>
            {when && <span className="queue-row-when"> · {when}</span>}
          </>
        ) : (
          <span className="queue-row-when">—</span>
        )}
      </span>
      {cta && <span className="queue-row-action">{cta}</span>}
    </Link>
  );
}
