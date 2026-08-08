"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Vocabulary } from "@/lib/vocabulary";
import { validateMarkdown, type Diagnostic } from "@/lib/validate-client";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; sha: string; commit?: { sha: string; url?: string } }
  | { kind: "error"; message: string }
  | { kind: "stale"; message: string };

type Props = {
  brand: string;
  slug: string;
  initialContent: string;
  initialSha: string | null;
  vocabulary: Vocabulary;
};

const PREVIEW_DEBOUNCE_MS = 1200;

export function Editor({ brand, slug, initialContent, initialSha, vocabulary }: Props) {
  const [content, setContent] = useState(initialContent);
  const [baseSha, setBaseSha] = useState(initialSha);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showPalette, setShowPalette] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPreviewed = useRef<string>("");
  const objectUrl = useRef<string | null>(null);

  const dirty = content !== initialContent || save.kind === "error" || save.kind === "stale";

  const diagnostics = useMemo(
    () => validateMarkdown(content, vocabulary),
    [content, vocabulary]
  );
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  /* ---------------- preview ---------------- */

  const runPreview = useCallback(async (src: string) => {
    if (src === lastPreviewed.current) return;
    lastPreviewed.current = src;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const res = await fetch(`/api/preview/${brand}/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: src }),
      });
      if (!res.ok) {
        setPreviewError((await res.text()).slice(0, 400));
        return;
      }
      const blob = await res.blob();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(blob);
      setPreviewUrl(objectUrl.current);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  }, [brand, slug]);

  // Debounced preview. Skipped while the document has errors — rendering
  // invalid markdown wastes a worker call and shows the author nothing useful.
  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (errors.length > 0) return;
    previewTimer.current = setTimeout(() => runPreview(content), PREVIEW_DEBOUNCE_MS);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [content, errors.length, runPreview]);

  // First render on mount.
  useEffect(() => {
    runPreview(initialContent);
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- save ---------------- */

  const doSave = useCallback(async () => {
    if (errors.length > 0) {
      setSave({ kind: "error", message: `${errors.length} validation error${errors.length > 1 ? "s" : ""} — fix before saving.` });
      return;
    }
    setSave({ kind: "saving" });
    try {
      const res = await fetch(`/api/doc/${brand}/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, baseSha }),
      });
      const data = await res.json();

      if (res.status === 409) {
        setSave({
          kind: "stale",
          message: data.message || "This document changed since you opened it.",
        });
        return;
      }
      if (res.status === 422) {
        const first = (data.diagnostics || [])[0];
        setSave({
          kind: "error",
          message: first ? `Line ${first.line}: ${first.message}` : "Validation failed.",
        });
        return;
      }
      if (!res.ok) {
        setSave({ kind: "error", message: data.error || `Save failed (${res.status})` });
        return;
      }

      setBaseSha(data.sha);
      setSave({ kind: "saved", sha: data.sha, commit: data.commit });
    } catch (e) {
      setSave({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [brand, slug, content, baseSha, errors.length]);

  // Cmd/Ctrl+S saves. Authors expect it; without it they will use the browser
  // save dialog and lose work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        doSave();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setShowPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave]);

  // Warn on navigation with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /* ---------------- snippet insertion ---------------- */

  const insertSnippet = useCallback((snippet: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end);
    const body = selected || "Content goes here.";
    const text = snippet.replace("$BODY$", body);
    const next = content.slice(0, start) + text + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + text.indexOf(body);
      el.setSelectionRange(cursor, cursor + body.length);
    });
    setShowPalette(false);
  }, [content]);

  const snippets = useMemo(
    () =>
      vocabulary.blocks.map((b) => {
        const requiredAttrs = Object.entries(b.attrs)
          .filter(([, s]) => s.required)
          .map(([n, s]) => `${n}="${s.values?.[0] ?? ""}"`);
        const enumAttrs = Object.entries(b.attrs)
          .filter(([, s]) => !s.required && s.type === "enum" && s.values?.length)
          .slice(0, 1)
          .map(([n, s]) => `${n}=${s.default ?? s.values![0]}`);
        const attrs = [...requiredAttrs, ...enumAttrs].join(" ");
        const opener = attrs ? `::: {.${b.id} ${attrs}}` : `::: ${b.id}`;
        const selfClosing = b.id === "pagebreak" || b.id === "toc";
        return {
          id: b.id,
          description: b.description,
          snippet: selfClosing ? `${opener}\n:::\n` : `${opener}\n$BODY$\n:::\n`,
        };
      }),
    [vocabulary]
  );

  /* ---------------- render ---------------- */

  const lineCount = content.split("\n").length;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <div className="editor-toolbar-left">
          <button className="btn btn-secondary" onClick={() => setShowPalette((v) => !v)}>
            Insert block <kbd>⌘/</kbd>
          </button>
          <span className="editor-stat">{lineCount} lines · {wordCount} words</span>
        </div>

        <div className="editor-toolbar-right">
          {previewing && <span className="editor-stat">rendering…</span>}
          {errors.length > 0 && (
            <span className="diag-pill" data-severity="error">
              {errors.length} error{errors.length > 1 ? "s" : ""}
            </span>
          )}
          {errors.length === 0 && warnings.length > 0 && (
            <span className="diag-pill" data-severity="warning">
              {warnings.length} warning{warnings.length > 1 ? "s" : ""}
            </span>
          )}
          {errors.length === 0 && warnings.length === 0 && (
            <span className="diag-pill" data-severity="ok">valid</span>
          )}
          <button
            className="btn"
            onClick={doSave}
            disabled={save.kind === "saving" || errors.length > 0 || !dirty}
          >
            {save.kind === "saving" ? "Saving…" : "Save"} <kbd>⌘S</kbd>
          </button>
        </div>
      </div>

      {showPalette && (
        <div className="palette">
          <div className="palette-head">
            Vocabulary — the closed set of blocks you may use
          </div>
          <div className="palette-grid">
            {snippets.map((s) => (
              <button key={s.id} className="palette-item" onClick={() => insertSnippet(s.snippet)}>
                <span className="palette-item-id">{s.id}</span>
                <span className="palette-item-desc">{s.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {save.kind === "stale" && (
        <div className="banner" data-kind="stale">
          <strong>This document changed while you were editing.</strong>
          <div>{save.message}</div>
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-secondary" onClick={() => window.location.reload()}>
              Reload and reapply
            </button>
          </div>
        </div>
      )}
      {save.kind === "error" && (
        <div className="banner" data-kind="error">{save.message}</div>
      )}
      {save.kind === "saved" && (
        <div className="banner" data-kind="ok">
          Saved{save.commit?.sha ? ` as ${save.commit.sha.slice(0, 7)}` : ""}.
        </div>
      )}

      <div className="editor-panes">
        <div className="pane pane-source">
          <textarea
            ref={textareaRef}
            className="source"
            value={content}
            spellCheck={false}
            onChange={(e) => {
              setContent(e.target.value);
              if (save.kind === "saved") setSave({ kind: "idle" });
            }}
          />
          {diagnostics.length > 0 && (
            <div className="diagnostics">
              {diagnostics.slice(0, 12).map((d, i) => (
                <div key={i} className="diagnostic" data-severity={d.severity}>
                  <span className="diagnostic-line">L{d.line}</span>
                  <span>{d.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pane pane-preview">
          {previewError ? (
            <div className="banner" data-kind="error" style={{ margin: 12 }}>
              <strong>Preview failed.</strong>
              <div><code>{previewError}</code></div>
            </div>
          ) : previewUrl ? (
            <iframe className="preview-frame" src={previewUrl} title="Live preview" />
          ) : (
            <div className="empty">Rendering first preview…</div>
          )}
          {errors.length > 0 && (
            <div className="preview-stale-note">
              Preview paused — fix {errors.length} error{errors.length > 1 ? "s" : ""} to resume.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
