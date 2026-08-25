import { loadVocabulary } from "@/lib/vocabulary";

/**
 * /primitives — Vocabulary reference page.
 *
 * A human- and agent-readable reference of every registered Docgent
 * primitive: blocks (with syntax, description, and attributes), inline
 * marks, and frontmatter fields.
 *
 * Also machine-readable as JSON: GET /api/primitives
 *
 * No authentication required — the vocabulary is not sensitive.
 */
export default function PrimitivesPage() {
  const vocab = loadVocabulary();

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px 80px" }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>
          Docgent Primitives
        </h1>
        <p style={{ color: "var(--ink-soft)", margin: "0 0 8px", fontSize: 14 }}>
          The complete vocabulary of blocks, inline marks, and frontmatter fields
          an author may use. Nothing outside this list is permitted in document source.
        </p>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-faint)" }}>
          Machine-readable:{" "}
          <a href="/api/primitives" style={{ fontFamily: "var(--mono)" }}>
            GET /api/primitives
          </a>
          {" · "}
          Source:{" "}
          <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
            packages/vocabulary/vocabulary.yaml
          </code>
        </p>
      </div>

      {/* ── Blocks ──────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 16px", borderBottom: "1px solid var(--rule)", paddingBottom: 8 }}>
          Blocks{" "}
          <span style={{ fontWeight: 400, color: "var(--ink-faint)", fontSize: 13 }}>
            ({vocab.blocks.length})
          </span>
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {vocab.blocks.map((b) => {
            const hasAttrs = Object.keys(b.attrs).length > 0;
            return (
              <div
                key={b.id}
                style={{
                  background: "var(--paper-alt)",
                  border: "1px solid var(--rule)",
                  borderRadius: 8,
                  padding: "14px 16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
                  <code
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--accent)",
                      background: "var(--accent-soft)",
                      padding: "1px 7px",
                      borderRadius: 4,
                    }}
                  >
                    {b.id}
                  </code>
                </div>
                {b.description && (
                  <p style={{ margin: "4px 0 8px", fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>
                    {b.description}
                  </p>
                )}
                {hasAttrs && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", color: "var(--ink-faint)", textTransform: "uppercase", marginBottom: 6 }}>
                      Attributes
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {Object.entries(b.attrs).map(([name, spec]) => (
                        <div key={name} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
                          <code style={{ fontFamily: "var(--mono)", color: "var(--ink)", minWidth: 100 }}>
                            {name}
                          </code>
                          <span style={{ color: "var(--ink-faint)" }}>
                            {spec.type}
                            {spec.values && spec.values.length > 0 && (
                              <> · {spec.values.join(" | ")}</>
                            )}
                            {spec.required && (
                              <> · <span style={{ color: "#b91c1c" }}>required</span></>
                            )}
                            {spec.default !== undefined && (
                              <> · default: <code style={{ fontFamily: "var(--mono)" }}>{spec.default}</code></>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Inlines ─────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px", borderBottom: "1px solid var(--rule)", paddingBottom: 8 }}>
          Inline Marks
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {vocab.inlineIds.map((id) => (
            <code
              key={id}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                background: "var(--paper-alt)",
                border: "1px solid var(--rule)",
                borderRadius: 4,
                padding: "3px 9px",
                color: "var(--ink-soft)",
              }}
            >
              {id}
            </code>
          ))}
        </div>
      </section>

      {/* ── Frontmatter ─────────────────────────────────────────────── */}
      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px", borderBottom: "1px solid var(--rule)", paddingBottom: 8 }}>
          Frontmatter
        </h2>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Required
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {vocab.frontmatter.required.map((f) => (
              <code
                key={f}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  background: "var(--accent-soft)",
                  border: "1px solid var(--accent)",
                  borderRadius: 4,
                  padding: "3px 9px",
                  color: "var(--accent)",
                }}
              >
                {f}
              </code>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Optional
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {vocab.frontmatter.optional.map((f) => (
              <code
                key={f}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  background: "var(--paper-alt)",
                  border: "1px solid var(--rule)",
                  borderRadius: 4,
                  padding: "3px 9px",
                  color: "var(--ink-soft)",
                }}
              >
                {f}
              </code>
            ))}
          </div>
        </div>
        {Object.keys(vocab.frontmatter.enums).length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Enum values
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(vocab.frontmatter.enums).map(([field, values]) => (
                <div key={field} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
                  <code style={{ fontFamily: "var(--mono)", color: "var(--ink)", minWidth: 120 }}>
                    {field}
                  </code>
                  <span style={{ color: "var(--ink-faint)" }}>{values.join(" | ")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
