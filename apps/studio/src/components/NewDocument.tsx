"use client";
import { useState } from "react";

/** Creation reuses PUT's authorisation, vocabulary and no-overwrite guards. */
export function NewDocument({ brands }: { brands: string[] }) {
  const [open, setOpen] = useState(false);
  const [brand, setBrand] = useState(brands[0] || "");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !brands.includes(brand) || !title.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return;
    setBusy(true); setError("");
    const content = `---\ntitle: ${JSON.stringify(title.trim())}\nbrand: ${JSON.stringify(brand)}\ndoctype: report\nversion: 1\ndate: ${new Date().toISOString().slice(0, 10)}\nstatus: draft\n---\n\n# Summary\n\nStart writing here.\n`;
    try {
      const response = await fetch(`/api/doc/${encodeURIComponent(brand)}/${slug}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, message: `docs(${brand}/${slug}): create document` }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(response.status === 428 || response.status === 409 ? "That URL name already exists. Choose another; nothing was overwritten." : result.error || "Creation failed. Try again.");
      window.location.href = `/${encodeURIComponent(brand)}/${slug}/edit`;
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return <>
    <button className="btn" disabled={!brands.length} aria-expanded={open} onClick={() => setOpen(!open)}>New document</button>
    {open && <form className="workspace-new-document" onSubmit={create} aria-label="Create document">
      <label>Brand<select aria-label="New document brand" value={brand} onChange={event => setBrand(event.target.value)}>{brands.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
      <label>Document title<input required value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>Document URL name<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={event => setSlug(event.target.value)} placeholder="quarterly-report" /></label>
      <p>Creates a draft report. You can change its type and content in Source.</p>
      {error && <p role="alert">{error}</p>}
      <button className="btn" disabled={busy} type="submit">{busy ? "Creating…" : "Create document"}</button>
      <button className="btn btn-secondary" disabled={busy} type="button" onClick={() => setOpen(false)}>Cancel</button>
    </form>}
  </>;
}
