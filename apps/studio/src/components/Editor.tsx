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

type PreviewMode = "html" | "pdf";

export function Editor({ brand, slug, initialContent, initialSha, vocabulary }: Props) {
  const [content, setContent] = useState(initialContent);
  const [baseSha, setBaseSha] = useState(initialSha);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [mode, setMode] = useState<PreviewMode>("html");
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pdfStale, setPdfStale] = useState(false);
  const [showPalette, setShowPalette] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPreviewed = useRef<string>("");
  const lastPdfRendered = useRef<string>("");
  const objectUrl = useRef<string | null>(null);
  // Guards the two-way scroll sync: whichever pane the user drives sets this,
  // so the programmatic scroll it causes on the other pane does not echo back.
  const syncLock = useRef<0 | 1 | 2>(0);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirty = content !== initialContent || save.kind === "error" || save.kind === "stale";

  const diagnostics = useMemo(
    () => validateMarkdown(content, vocabulary),
    [content, vocabulary]
  );
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  /* ---------------- preview ---------------- */

  const runHtmlPreview = useCallback(async (src: string) => {
    if (src === lastPreviewed.current) return;
    lastPreviewed.current = src;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const res = await fetch(`/api/preview/${brand}/${slug}/html`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: src }),
      });
      if (!res.ok) {
        setPreviewError((await res.text()).slice(0, 400));
        return;
      }
      setPreviewHtml(await res.text());
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  }, [brand, slug]);

  // PDF is an explicit action: it is the slow, faithful path, so it renders on
  // demand rather than on every keystroke.
  const runPdfPreview = useCallback(async (src: string) => {
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
      lastPdfRendered.current = src;
      setPdfStale(false);
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
    if (content !== lastPdfRendered.current) setPdfStale(true);
    if (mode !== "html") return;
    previewTimer.current = setTimeout(() => runHtmlPreview(content), PREVIEW_DEBOUNCE_MS);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [content, errors.length, runHtmlPreview, mode]);

  // First render on mount.
  useEffect(() => {
    runHtmlPreview(initialContent);
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching to PDF renders on demand if the buffer moved since the last one.
  useEffect(() => {
    if (mode !== "pdf") return;
    if (errors.length > 0) return;
    if (content === lastPdfRendered.current && previewUrl) return;
    runPdfPreview(content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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

  /* ---------------- scroll sync ---------------- */

  // Source line for the top visible row of the textarea. Derived from scroll
  // offset over line height, which is exact because the textarea is uniform
  // monospace with no wrapped-line accounting beyond its own layout.
  const topSourceLine = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return 1;
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || 18;
    const padTop = parseFloat(cs.paddingTop) || 0;
    return Math.max(1, Math.round((el.scrollTop - padTop) / lh) + 1);
  }, []);

  const anchors = useCallback((): { line: number; el: HTMLElement }[] => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return [];
    return Array.from(doc.querySelectorAll<HTMLElement>("[data-source-line]"))
      .map((el) => ({ line: Number(el.dataset.sourceLine), el }))
      .filter((a) => Number.isFinite(a.line))
      .sort((a, b) => a.line - b.line);
  }, []);

  const lockSync = useCallback((who: 1 | 2) => {
    syncLock.current = who;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      syncLock.current = 0;
    }, 120);
  }, []);

  // Editor -> preview. Interpolates between the two nearest anchors so the
  // preview tracks continuously rather than jumping block to block.
  const syncEditorToPreview = useCallback(() => {
    if (mode !== "html" || syncLock.current === 2) return;
    const doc = frameRef.current?.contentDocument;
    const win = frameRef.current?.contentWindow;
    if (!doc || !win) return;
    const list = anchors();
    if (list.length === 0) return;

    const line = topSourceLine();
    let lo = list[0];
    let hi = list[list.length - 1];
    for (let i = 0; i < list.length; i++) {
      if (list[i].line <= line) lo = list[i];
      if (list[i].line >= line) { hi = list[i]; break; }
    }
    const loTop = lo.el.offsetTop;
    const hiTop = hi.el.offsetTop;
    const span = hi.line - lo.line;
    const frac = span > 0 ? (line - lo.line) / span : 0;
    const target = loTop + (hiTop - loTop) * frac;

    lockSync(1);
    win.scrollTo({ top: Math.max(0, target - 8), behavior: "auto" });
  }, [mode, anchors, topSourceLine, lockSync]);

  // Preview -> editor. Finds the topmost anchor still on screen and scrolls
  // the textarea to the line that produced it.
  const syncPreviewToEditor = useCallback(() => {
    if (mode !== "html" || syncLock.current === 1) return;
    const el = textareaRef.current;
    const win = frameRef.current?.contentWindow;
    if (!el || !win) return;
    const list = anchors();
    if (list.length === 0) return;

    const y = win.scrollY;
    let current = list[0];
    for (const a of list) {
      if (a.el.offsetTop <= y + 12) current = a;
      else break;
    }
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || 18;
    lockSync(2);
    el.scrollTop = Math.max(0, (current.line - 1) * lh);
  }, [mode, anchors, lockSync]);

  // Attach the preview-side listener whenever the iframe document changes.
  useEffect(() => {
    if (mode !== "html") return;
    const frame = frameRef.current;
    if (!frame) return;
    const attach = () => {
      const win = frame.contentWindow;
      if (!win) return;
      win.addEventListener("scroll", syncPreviewToEditor, { passive: true });
    };
    attach();
    frame.addEventListener("load", attach);
    return () => {
      frame.removeEventListener("load", attach);
      frame.contentWindow?.removeEventListener("scroll", syncPreviewToEditor);
    };
  }, [mode, previewHtml, syncPreviewToEditor]);

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
          <div className="mode-toggle" role="group" aria-label="Preview mode">
            <button
              className="mode-btn"
              data-active={mode === "html"}
              onClick={() => setMode("html")}
              title="Fast preview with synchronised scrolling"
            >
              Preview
            </button>
            <button
              className="mode-btn"
              data-active={mode === "pdf"}
              onClick={() => setMode("pdf")}
              title="Paginated PDF — exact print fidelity"
            >
              PDF{pdfStale && mode === "pdf" ? " •" : ""}
            </button>
          </div>
          {mode === "pdf" && (
            <button
              className="btn btn-secondary"
              onClick={() => runPdfPreview(content)}
              disabled={previewing || errors.length > 0}
            >
              {previewing ? "Rendering…" : pdfStale ? "Re-render PDF" : "Render PDF"}
            </button>
          )}
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
            onScroll={syncEditorToPreview}
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
          ) : mode === "html" ? (
            previewHtml ? (
              <iframe
                ref={frameRef}
                className="preview-frame"
                srcDoc={previewHtml}
                title="Live preview"
                sandbox="allow-same-origin"
              />
            ) : (
              <div className="empty">Rendering first preview…</div>
            )
          ) : previewUrl ? (
            <iframe className="preview-frame" src={previewUrl} title="PDF preview" />
          ) : (
            <div className="empty">
              {previewing ? "Rendering PDF…" : "Render the PDF to see paginated output."}
            </div>
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
