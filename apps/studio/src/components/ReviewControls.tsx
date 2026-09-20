"use client";
import { useState } from "react";

const actions: Record<string, [string, string][]> = {
  draft: [["review", "Request review"]],
  review: [["approved", "Approve"], ["draft", "Return to draft"]],
  approved: [["released", "Mark as released"], ["review", "Return to review"]],
  released: [["superseded", "Supersede"]],
};

/** Source review is explicit; a PDF loading event is not proof of inspection. */
export function ReviewControls({ brand, slug, baseSha, status = "draft", source }: {
  brand: string; slug: string; baseSha?: string; status?: string; source: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!baseSha || !actions[status]?.length) return null;
  async function transition(to: string) {
    if (!confirmed || pending) return;
    setPending(to);
    setError(null);
    try {
      const res = await fetch(`/api/status/${brand}/${slug}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, baseSha }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.hint || data.message || data.error || "Status change failed."); return; }
      window.location.reload();
    } catch { setError("Could not confirm the change. Reload to check status before retrying."); }
    finally { setPending(null); }
  }
  return <section aria-label="Human review" className="panel">
    <div className="panel-head">Human review</div>
    <div className="panel-body">
      <p>Review this exact source version before changing its status. Approval covers source, not factual accuracy or a frozen preview PDF.</p>
      <code style={{ overflowWrap: "anywhere" }}>{baseSha}</code>
      <details><summary>Inspect source for this version</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 360, overflow: "auto" }}>{source}</pre>
      </details>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I have reviewed this source version and intend this status change.</label>
      <p>Marking as released records a status change and locks this issue. No PDF is archived; subsequent downloads remain regenerable previews and can change with branding or renderer updates.</p>
      {actions[status].map(([to, label]) => <button key={to} type="button" className="btn btn-secondary" disabled={!confirmed || pending !== null} onClick={() => transition(to)}>{label}</button>)}
      {error && <p role="alert">{error}</p>}
    </div>
  </section>;
}
