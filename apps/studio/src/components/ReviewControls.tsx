"use client";
import { useState } from "react";

const actions: [string, string][] = [
  ["draft", "Return to draft"], ["review", "Request review"], ["approved", "Approve"],
  ["released", "Mark as released"], ["superseded", "Supersede"],
];

/** Optional review and version-bound status changes; never an editing gate. */
export function ReviewControls({ brand, slug, baseSha, status = "draft", source }: {
  brand: string; slug: string; baseSha?: string; status?: string; source: string;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!baseSha) return null;
  async function transition(to: string) {
    if (pending) return;
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
  return <section aria-label="Review & status" className="panel">
    <div className="panel-head">Review & status</div>
    <div className="panel-body">
      <p>Review is optional. Authorized people and agents can edit, accept rewrites, restore, or change status at any stage. Every change is versioned in Git.</p>
      <code style={{ overflowWrap: "anywhere" }}>{baseSha}</code>
      <details><summary>Inspect source for this version</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 360, overflow: "auto" }}>{source}</pre>
      </details>
      <p>Status never locks editing. Status labels persist across edits and are not evidence that the current content was reviewed. Check version history for earlier sign-offs. No PDF is archived; subsequent downloads remain regenerable previews and can change with branding or renderer updates.</p>
      {actions.filter(([to]) => to !== status).map(([to, label]) => <button key={to} type="button" className="btn btn-secondary" disabled={pending !== null} onClick={() => transition(to)}>{label}</button>)}
      {error && <p role="alert">{error}</p>}
    </div>
  </section>;
}
