"use client";

import { useState } from "react";
import Link from "next/link";

type BrandSummary = { id: string; name: string; configured: boolean };

/**
 * Client component: create-brand is inherently interactive (form state,
 * inline error), and re-fetching the list after a successful create is
 * simpler than a full page reload losing scroll position for what will
 * often be a long brand list over time.
 */
export function BrandList({ initialBrands }: { initialBrands: BrandSummary[] }) {
  const [items, setItems] = useState(initialBrands);
  const [creating, setCreating] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/brands", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create brand");
        return;
      }
      setItems((prev) => [...prev, { id: data.id, name: name || data.id, configured: false }].sort((a, b) => a.id.localeCompare(b.id)));
      setId("");
      setName("");
      setCreating(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="btn" onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "New brand"}
        </button>
      </div>

      {creating && (
        <form onSubmit={submitCreate} className="signin-card" style={{ maxWidth: 480 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <label>
              <div style={{ fontSize: 12.5, marginBottom: 4 }}>Brand id (lowercase, hyphens only)</div>
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="e.g. acme-co"
                required
                style={{ width: "100%", padding: "8px 10px" }}
              />
            </label>
            <label>
              <div style={{ fontSize: 12.5, marginBottom: 4 }}>Display name</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme Co"
                style={{ width: "100%", padding: "8px 10px" }}
              />
            </label>
            {error && (
              <div className="error-box">
                <code>{error}</code>
              </div>
            )}
            <button type="submit" className="btn" disabled={busy || !id}>
              {busy ? "Creating…" : "Create brand"}
            </button>
          </div>
        </form>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {items.length === 0 && <p className="signin-sub">No brands yet.</p>}
        {items.map((b) => (
          <Link
            key={b.id}
            href={`/admin/brands/${b.id}`}
            className="signin-card"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", textDecoration: "none" }}
          >
            <div>
              <strong>{b.name}</strong>
              <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>{b.id}</div>
            </div>
            {!b.configured && (
              <span style={{ fontSize: 12, color: "var(--warning, #FF5E17)" }}>needs repo:</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
