"use client";

import { useState } from "react";

type Props = {
  brandId: string;
  initialYaml: string;
  scaffold: Record<string, string[]>;
};

/**
 * Raw textarea, not a structured form over brand.yaml's fields.
 *
 * brand.yaml has grown organically (typography, palette, page, numbering,
 * cover, footer, header, classification_labels, and whatever the next brand
 * needs that today's brands don't) — building and maintaining a form field
 * per key would mean this editor is permanently one release behind the
 * actual schema, or silently drops keys the form doesn't know about on
 * save. A textarea can never do that: it round-trips exactly what it was
 * given, plus whatever the admin typed.
 */
export function BrandEditor({ brandId, initialYaml, scaffold }: Props) {
  const [yaml, setYaml] = useState(initialYaml);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty = yaml !== initialYaml;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/brands/${brandId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Save failed");
        return;
      }
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 900 }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <strong style={{ fontSize: 13 }}>brand.yaml</strong>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {savedAt && !dirty && <span style={{ fontSize: 12, color: "var(--success, #61BE88)" }}>Saved</span>}
            <button type="button" className="btn" onClick={save} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        <textarea
          value={yaml}
          onChange={(e) => setYaml(e.target.value)}
          spellCheck={false}
          style={{
            width: "100%",
            minHeight: 480,
            fontFamily: "var(--mono)",
            fontSize: 13,
            lineHeight: 1.5,
            padding: 12,
            border: "1px solid var(--rule)",
            borderRadius: 6,
            resize: "vertical",
          }}
        />
        {error && (
          <div className="error-box" style={{ marginTop: 8 }}>
            <code>{error}</code>
          </div>
        )}
      </div>

      <div>
        <strong style={{ fontSize: 13 }}>Scaffold</strong>
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {Object.entries(scaffold).map(([folder, files]) => (
            <div key={folder} style={{ fontSize: 12.5 }}>
              <code>{folder}/</code>{" "}
              {files.length === 0 ? (
                <span style={{ color: "var(--ink-faint)" }}>empty</span>
              ) : (
                <span style={{ color: "var(--ink-faint)" }}>{files.join(", ")}</span>
              )}
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 8 }}>
          Asset upload (logos, fonts, doctypes) is not part of this editor yet — add files directly
          under <code>brands/{brandId}/</code> for now.
        </p>
      </div>
    </div>
  );
}
