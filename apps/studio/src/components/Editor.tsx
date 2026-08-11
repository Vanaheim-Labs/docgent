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

// Edit weights the source; Review weights the preview. Editing only ever
// happens in the source, so this changes proportions, never affordances.
type Posture = "edit" | "review";

type Heading = { line: number; level: number; text: string };

// A folded section hides its body lines in the source while keeping the
// heading visible. Folding is a view state over the buffer: the underlying
// content is never modified, so a fold can never corrupt a document.
type Fold = { startLine: number; endLine: number };

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
  const [posture, setPosture] = useState<Posture>("edit");
  const [showOutline, setShowOutline] = useState(true);
  const [folded, setFolded] = useState<number[]>([]);

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

  // Maps logical source lines to pixel offsets inside the textarea.
  //
  // scrollTop / lineHeight is wrong here: the textarea soft-wraps, so one
  // logical line can occupy many visual rows. On a real document that error
  // compounds badly (a 674-line memo measured ~1272 visual rows, putting the
  // naive estimate 288 lines out by the midpoint). Instead the wrapped height
  // of each line is measured once with a mirror element that copies the
  // textarea metrics, giving exact offsets.
  const offsets = useRef<number[] | null>(null);

  const measureOffsets = useCallback((): number[] => {
    const el = textareaRef.current;
    if (!el) return [0];
    const cs = getComputedStyle(el);
    const mirror = document.createElement("div");
    // Match every property that affects wrapping, then take it out of flow.
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.pointerEvents = "none";
    mirror.style.top = "0";
    mirror.style.left = "-9999px";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordBreak = cs.wordBreak;
    mirror.style.overflowWrap = cs.overflowWrap;
    mirror.style.font = cs.font;
    mirror.style.fontFamily = cs.fontFamily;
    mirror.style.fontSize = cs.fontSize;
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.tabSize = cs.tabSize;
    mirror.style.paddingLeft = cs.paddingLeft;
    mirror.style.paddingRight = cs.paddingRight;
    mirror.style.boxSizing = cs.boxSizing;
    mirror.style.width = `${el.clientWidth}px`;
    document.body.appendChild(mirror);

    const lines = content.split("\n");
    const out: number[] = new Array(lines.length + 1);
    // One span per line, measured in a single layout pass.
    const spans: HTMLElement[] = lines.map((ln) => {
      const d = document.createElement("div");
      d.textContent = ln.length ? ln : "\u200b";
      mirror.appendChild(d);
      return d;
    });
    for (let i = 0; i < spans.length; i++) out[i] = spans[i].offsetTop;
    out[lines.length] = mirror.scrollHeight;
    document.body.removeChild(mirror);
    return out;
  }, [content]);

  // Re-measure when the text or the pane width changes; both alter wrapping.
  useEffect(() => {
    offsets.current = null;
  }, [content]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      offsets.current = null;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lineOffsets = useCallback((): number[] => {
    if (!offsets.current) offsets.current = measureOffsets();
    return offsets.current;
  }, [measureOffsets]);

  // Fractional source line at the top of the viewport. Fractional so the
  // preview glides through long wrapped paragraphs instead of stepping.
  const topSourceLine = useCallback((): number => {
    const el = textareaRef.current;
    if (!el) return 1;
    const offs = lineOffsets();
    const y = el.scrollTop;
    // Binary search for the line containing this offset.
    let lo = 0;
    let hi = offs.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (offs[mid] <= y) lo = mid;
      else hi = mid;
    }
    const span = offs[lo + 1] - offs[lo];
    const frac = span > 0 ? (y - offs[lo]) / span : 0;
    return lo + 1 + Math.min(1, Math.max(0, frac));
  }, [lineOffsets]);

  // Pixel offset for a (possibly fractional) source line.
  const offsetForLine = useCallback((line: number): number => {
    const offs = lineOffsets();
    const idx = Math.min(offs.length - 2, Math.max(0, Math.floor(line) - 1));
    const frac = line - Math.floor(line);
    return offs[idx] + (offs[idx + 1] - offs[idx]) * frac;
  }, [lineOffsets]);

  const anchors = useCallback((): { line: number; el: HTMLElement }[] => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return [];
    return Array.from(doc.querySelectorAll<HTMLElement>("[data-source-line]"))
      .map((el) => ({ line: Number(el.dataset.sourceLine), el }))
      .filter((a) => Number.isFinite(a.line))
      .sort((a, b) => a.line - b.line);
  }, []);

  // Absolute document offset of an element inside the iframe. offsetTop is
  // relative to the offsetParent, which is not the document once blocks sit
  // inside positioned sections.
  const docTop = useCallback((el: HTMLElement, win: Window): number => {
    const r = el.getBoundingClientRect();
    return r.top + win.scrollY;
  }, []);

  // Suppresses the echo a programmatic scroll causes on the other pane.
  //
  // Two things make a naive flag insufficient. The lock has to be taken
  // before any layout is read, because forcing layout gives the other pane's
  // handler a chance to run inside the gap. And scrollTo dispatches its event
  // asynchronously, so the lock must outlive the call itself; it is released
  // one frame after the last echoed event rather than on a fixed timer, which
  // would expire mid-gesture during continuous scrolling.
  const releaseSync = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      syncLock.current = 0;
      syncTimer.current = null;
    }, 80);
  }, []);

  const lockSync = useCallback((who: 1 | 2) => {
    syncLock.current = who;
    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
      syncTimer.current = null;
    }
  }, []);

  // Editor -> preview. Interpolates between the two nearest anchors so the
  // preview tracks continuously rather than jumping block to block.
  const syncEditorToPreview = useCallback(() => {
    if (mode !== "html") return;
    // An echo from a preview-driven scroll: swallow it and re-arm.
    if (syncLock.current === 2) { releaseSync(); return; }
    const win = frameRef.current?.contentWindow;
    if (!win) return;

    // Claim the lock before reading layout below.
    lockSync(1);

    const list = anchors();
    if (list.length === 0) { releaseSync(); return; }

    const line = topSourceLine();
    let lo = list[0];
    let hi = list[list.length - 1];
    for (let i = 0; i < list.length; i++) {
      if (list[i].line <= line) lo = list[i];
      if (list[i].line >= line) { hi = list[i]; break; }
    }

    const loTop = docTop(lo.el, win);
    const hiTop = docTop(hi.el, win);
    const span = hi.line - lo.line;
    const frac = span > 0 ? (line - lo.line) / span : 0;
    const target = loTop + (hiTop - loTop) * Math.min(1, Math.max(0, frac));
    const next = Math.max(0, target - 8);

    // Skip sub-pixel corrections; they generate echoes with no visible gain.
    if (Math.abs(win.scrollY - next) < 2) { releaseSync(); return; }

    win.scrollTo({ top: next, behavior: "auto" });
    releaseSync();
  }, [mode, anchors, topSourceLine, docTop, lockSync, releaseSync]);

  // Preview -> editor. Interpolates between the anchors bracketing the
  // viewport top, then converts that line back to a measured pixel offset.
  const syncPreviewToEditor = useCallback(() => {
    if (mode !== "html") return;
    if (syncLock.current === 1) { releaseSync(); return; }
    const el = textareaRef.current;
    const win = frameRef.current?.contentWindow;
    if (!el || !win) return;

    lockSync(2);

    const list = anchors();
    if (list.length === 0) { releaseSync(); return; }

    const y = win.scrollY + 8;
    let lo = list[0];
    let hi = list[list.length - 1];
    for (let i = 0; i < list.length; i++) {
      const t = docTop(list[i].el, win);
      if (t <= y) lo = list[i];
      if (t >= y) { hi = list[i]; break; }
    }

    const loTop = docTop(lo.el, win);
    const hiTop = docTop(hi.el, win);
    const pxSpan = hiTop - loTop;
    const frac = pxSpan > 0 ? (y - loTop) / pxSpan : 0;
    const line = lo.line + (hi.line - lo.line) * Math.min(1, Math.max(0, frac));
    const next = Math.max(0, offsetForLine(line));

    if (Math.abs(el.scrollTop - next) < 2) { releaseSync(); return; }

    el.scrollTop = next;
    releaseSync();
  }, [mode, anchors, docTop, offsetForLine, lockSync, releaseSync]);
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

  /* ---------------- outline ---------------- */

  // Headings are derived from the buffer on every change rather than cached.
  // A stale outline that points at the wrong line is worse than no outline:
  // the human loses trust in navigation the first time it lands them badly.
  // Fenced code blocks are skipped so a '#' comment inside one is not
  // mistaken for a section.
  const headings = useMemo<Heading[]>(() => {
    const lines = content.split("\n");
    const out: Heading[] = [];
    let inFence = false;
    let inFrontmatter = false;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (i === 0 && raw.trim() === "---") { inFrontmatter = true; continue; }
      if (inFrontmatter) {
        if (raw.trim() === "---") inFrontmatter = false;
        continue;
      }
      if (/^\s*(```|~~~)/.test(raw)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const m = raw.match(/^(#{1,6})\s+(.*\S)\s*$/);
      if (m) out.push({ line: i + 1, level: m[1].length, text: m[2] });
    }
    return out;
  }, [content]);

  // A section runs to the next heading of the same or shallower level.
  // Folding a level-1 heading therefore folds its subsections too, which is
  // what "collapse this section" means to a reader.
  const sectionEnd = useCallback((h: Heading): number => {
    const lines = content.split("\n").length;
    const idx = headings.findIndex((x) => x.line === h.line);
    for (let i = idx + 1; i < headings.length; i++) {
      if (headings[i].level <= h.level) return headings[i].line - 1;
    }
    return lines;
  }, [content, headings]);

  const folds = useMemo<Fold[]>(() => {
    return folded
      .map((line) => {
        const h = headings.find((x) => x.line === line);
        if (!h) return null;
        const end = sectionEnd(h);
        return end > h.line ? { startLine: h.line, endLine: end } : null;
      })
      .filter((f): f is Fold => f !== null)
      .sort((a, b) => a.startLine - b.startLine);
  }, [folded, headings, sectionEnd]);

  // Folds are a view over the buffer, so the textarea must show a reduced
  // string. Editing while folded is disabled rather than remapped: mapping
  // cursor offsets back through hidden ranges is a well-known source of
  // silent corruption, and this document is the source of truth for a client
  // deliverable. Fold to navigate, unfold to edit.
  const displayContent = useMemo(() => {
    if (folds.length === 0) return content;
    const lines = content.split("\n");
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const ln = i + 1;
      const fold = folds.find((f) => f.startLine === ln);
      if (fold) {
        out.push(lines[i]);
        const hidden = fold.endLine - fold.startLine;
        out.push(`⋯ ${hidden} line${hidden === 1 ? "" : "s"} folded`);
        i = fold.endLine;
        continue;
      }
      out.push(lines[i]);
      i++;
    }
    return out.join("\n");
  }, [content, folds]);

  const isFolded = folds.length > 0;

  const toggleFold = useCallback((line: number) => {
    setFolded((prev) =>
      prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line]
    );
  }, []);

  // Jumping unfolds anything covering the target, otherwise the scroll lands
  // on a collapsed placeholder and the human sees nothing.
  const jumpToLine = useCallback((line: number) => {
    setFolded((prev) =>
      prev.filter((f) => {
        const h = headings.find((x) => x.line === f);
        if (!h) return false;
        if (h.line === line) return false;
        return !(line > h.line && line <= sectionEnd(h));
      })
    );
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      offsets.current = null;
      const offs = lineOffsets();
      const idx = Math.min(offs.length - 2, Math.max(0, line - 1));
      el.scrollTop = Math.max(0, offs[idx] - 8);
      el.focus();
      const pos = content.split("\n").slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0);
      el.setSelectionRange(pos, pos);
      syncEditorToPreview();
    });
  }, [headings, sectionEnd, lineOffsets, content, syncEditorToPreview]);

  /* ---------------- markdown formatting ---------------- */

  // All formatting rewrites the buffer through a single primitive: replace a
  // range and restore a selection. Going through one path means undo history,
  // fold-guarding and preview invalidation behave identically for every
  // button, rather than each action inventing its own edge cases.
  const applyEdit = useCallback(
    (next: string, selStart: number, selEnd: number) => {
      setContent(next);
      setSave((s) => (s.kind === "saved" ? { kind: "idle" } : s));
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(selStart, selEnd);
      });
    },
    []
  );

  // Inline marks (bold, italic, code, strikethrough) toggle. If the selection
  // is already wrapped — or sits immediately inside the marks — the marks are
  // removed instead of nested, because "**\*\*bold\*\***" is the classic way a
  // toolbar silently corrupts a document.
  const toggleInline = useCallback(
    (mark: string, placeholder: string) => {
      const el = textareaRef.current;
      if (!el || isFolded) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = content.slice(start, end);
      const len = mark.length;

      // Marks inside the selection.
      if (
        selected.length >= len * 2 &&
        selected.startsWith(mark) &&
        selected.endsWith(mark)
      ) {
        const inner = selected.slice(len, -len);
        applyEdit(
          content.slice(0, start) + inner + content.slice(end),
          start,
          start + inner.length
        );
        return;
      }

      // Marks just outside the selection.
      const before = content.slice(Math.max(0, start - len), start);
      const after = content.slice(end, end + len);
      if (before === mark && after === mark) {
        applyEdit(
          content.slice(0, start - len) + selected + content.slice(end + len),
          start - len,
          start - len + selected.length
        );
        return;
      }

      const body = selected || placeholder;
      const text = mark + body + mark;
      applyEdit(
        content.slice(0, start) + text + content.slice(end),
        start + len,
        start + len + body.length
      );
    },
    [content, isFolded, applyEdit]
  );

  // Line-level transforms operate on whole lines, so the selection is first
  // expanded to line boundaries. Without that, applying a heading to a
  // mid-line cursor would inject '#' into the middle of a sentence.
  const transformLines = useCallback(
    (fn: (lines: string[]) => string[]) => {
      const el = textareaRef.current;
      if (!el || isFolded) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const from = content.lastIndexOf("\n", start - 1) + 1;
      let to = content.indexOf("\n", end);
      if (to === -1) to = content.length;
      // A selection ending exactly at a line start should not pull in the
      // following line.
      const effectiveTo = end > from && content[end - 1] === "\n" && end - 1 >= from ? end - 1 : to;

      const block = content.slice(from, effectiveTo);
      const next = fn(block.split("\n")).join("\n");
      applyEdit(
        content.slice(0, from) + next + content.slice(effectiveTo),
        from,
        from + next.length
      );
    },
    [content, isFolded, applyEdit]
  );

  // Headings cycle: applying the level already present removes it, so the
  // same button both promotes and clears.
  const applyHeading = useCallback(
    (level: number) => {
      const hashes = "#".repeat(level);
      transformLines((lines) => {
        const allAt = lines.every((l) => l.trim() === "" || l.startsWith(hashes + " "));
        return lines.map((l) => {
          if (l.trim() === "") return l;
          const bare = l.replace(/^#{1,6}\s+/, "");
          return allAt ? bare : `${hashes} ${bare}`;
        });
      });
    },
    [transformLines]
  );

  const applyBullets = useCallback(() => {
    transformLines((lines) => {
      const allBul = lines.every((l) => l.trim() === "" || /^\s*[-*+]\s+/.test(l));
      return lines.map((l) => {
        if (l.trim() === "") return l;
        return allBul ? l.replace(/^(\s*)[-*+]\s+/, "$1") : `- ${l.replace(/^\s*/, "")}`;
      });
    });
  }, [transformLines]);

  const applyNumbered = useCallback(() => {
    transformLines((lines) => {
      const allNum = lines.every((l) => l.trim() === "" || /^\s*\d+\.\s+/.test(l));
      let n = 0;
      return lines.map((l) => {
        if (l.trim() === "") return l;
        if (allNum) return l.replace(/^(\s*)\d+\.\s+/, "$1");
        n += 1;
        return `${n}. ${l.replace(/^\s*/, "")}`;
      });
    });
  }, [transformLines]);

  const applyQuote = useCallback(() => {
    transformLines((lines) => {
      const allQ = lines.every((l) => l.trim() === "" || /^\s*>\s?/.test(l));
      return lines.map((l) => {
        if (l.trim() === "") return l;
        return allQ ? l.replace(/^(\s*)>\s?/, "$1") : `> ${l}`;
      });
    });
  }, [transformLines]);

  // A link keeps whatever the author selected as the visible text and puts the
  // cursor on the URL, which is the part they still have to supply.
  const insertLink = useCallback(() => {
    const el = textareaRef.current;
    if (!el || isFolded) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end);
    const label = selected || "link text";
    const text = `[${label}](url)`;
    const urlAt = start + label.length + 3;
    applyEdit(content.slice(0, start) + text + content.slice(end), urlAt, urlAt + 3);
  }, [content, isFolded, applyEdit]);

  const insertRule = useCallback(() => {
    const el = textareaRef.current;
    if (!el || isFolded) return;
    const start = el.selectionStart;
    const atLineStart = start === 0 || content[start - 1] === "\n";
    const text = `${atLineStart ? "" : "\n"}\n---\n\n`;
    const pos = start + text.length;
    applyEdit(content.slice(0, start) + text + content.slice(start), pos, pos);
  }, [content, isFolded, applyEdit]);

  const insertCodeBlock = useCallback(() => {
    const el = textareaRef.current;
    if (!el || isFolded) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end);
    const body = selected || "code";
    const atLineStart = start === 0 || content[start - 1] === "\n";
    const lead = atLineStart ? "" : "\n";
    const text = `${lead}\`\`\`\n${body}\n\`\`\`\n`;
    const bodyAt = start + lead.length + 4;
    applyEdit(content.slice(0, start) + text + content.slice(end), bodyAt, bodyAt + body.length);
  }, [content, isFolded, applyEdit]);

  // Keyboard shortcuts for the marks authors reach for most. Registered on the
  // textarea rather than the window so they cannot hijack typing elsewhere.
  const onSourceKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "b") { e.preventDefault(); toggleInline("**", "bold text"); }
      else if (k === "i") { e.preventDefault(); toggleInline("*", "italic text"); }
      else if (k === "e") { e.preventDefault(); toggleInline("\`", "code"); }
      else if (k === "k") { e.preventDefault(); insertLink(); }
    },
    [toggleInline, insertLink]
  );

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
          <button
            className="btn btn-secondary"
            onClick={() => setShowOutline((v) => !v)}
            data-active={showOutline}
            title="Toggle document outline"
          >
            Outline
          </button>
          <div className="mode-toggle" role="group" aria-label="Working posture">
            <button
              className="mode-btn"
              data-active={posture === "edit"}
              onClick={() => setPosture("edit")}
              title="Authoring — source takes the space"
            >
              Edit
            </button>
            <button
              className="mode-btn"
              data-active={posture === "review"}
              onClick={() => setPosture("review")}
              title="Judgement — read it as the reader will"
            >
              Review
            </button>
          </div>
          <span className="editor-stat">{lineCount} lines · {wordCount} words</span>
          {isFolded && (
            <span className="diag-pill" data-severity="warning" title="Unfold to edit">
              folded — read only
            </span>
          )}
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

      {/* Formatting bar. Deliberately a second row rather than crammed into the
          toolbar: these are per-selection text actions, whereas the row above
          holds document-level state (posture, preview, save). Mixing them
          makes the destructive actions harder to find in a hurry. */}
      <div className="format-bar" role="toolbar" aria-label="Markdown formatting">
        <div className="format-group">
          {([1, 2, 3] as const).map((lvl) => (
            <button
              key={lvl}
              className="format-btn"
              onClick={() => applyHeading(lvl)}
              disabled={isFolded}
              title={`Heading ${lvl}`}
              aria-label={`Heading ${lvl}`}
            >
              H{lvl}
            </button>
          ))}
        </div>

        <div className="format-group">
          <button
            className="format-btn"
            onClick={() => toggleInline("**", "bold text")}
            disabled={isFolded}
            title="Bold — ⌘B"
            aria-label="Bold"
          >
            <strong>B</strong>
          </button>
          <button
            className="format-btn"
            onClick={() => toggleInline("*", "italic text")}
            disabled={isFolded}
            title="Italic — ⌘I"
            aria-label="Italic"
          >
            <em>I</em>
          </button>
          <button
            className="format-btn"
            onClick={() => toggleInline("~~", "struck text")}
            disabled={isFolded}
            title="Strikethrough"
            aria-label="Strikethrough"
          >
            <s>S</s>
          </button>
          <button
            className="format-btn format-btn-mono"
            onClick={() => toggleInline("`", "code")}
            disabled={isFolded}
            title="Inline code — ⌘E"
            aria-label="Inline code"
          >
            {"<>"}
          </button>
        </div>

        <div className="format-group">
          <button
            className="format-btn"
            onClick={applyBullets}
            disabled={isFolded}
            title="Bulleted list"
            aria-label="Bulleted list"
          >
            ••
          </button>
          <button
            className="format-btn"
            onClick={applyNumbered}
            disabled={isFolded}
            title="Numbered list"
            aria-label="Numbered list"
          >
            1.
          </button>
          <button
            className="format-btn"
            onClick={applyQuote}
            disabled={isFolded}
            title="Blockquote"
            aria-label="Blockquote"
          >
            &rdquo;
          </button>
        </div>

        <div className="format-group">
          <button
            className="format-btn"
            onClick={insertLink}
            disabled={isFolded}
            title="Link — ⌘K"
            aria-label="Insert link"
          >
            Link
          </button>
          <button
            className="format-btn format-btn-mono"
            onClick={insertCodeBlock}
            disabled={isFolded}
            title="Code block"
            aria-label="Insert code block"
          >
            {"{ }"}
          </button>
          <button
            className="format-btn"
            onClick={insertRule}
            disabled={isFolded}
            title="Horizontal rule"
            aria-label="Insert horizontal rule"
          >
            —
          </button>
        </div>

        {isFolded && (
          <span className="format-note">unfold a section to edit</span>
        )}
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

      <div className="editor-panes" data-posture={posture}>
        <div className="pane pane-source" data-outline={showOutline && headings.length > 0}>
          {showOutline && headings.length > 0 && (
            <nav className="outline" aria-label="Document outline">
              <div className="outline-head">
                <span>Outline</span>
                <span className="outline-count">{headings.length}</span>
              </div>
              <div className="outline-list">
                {headings.map((h) => {
                  const foldable = sectionEnd(h) > h.line;
                  const isOpen = !folded.includes(h.line);
                  return (
                    <div key={h.line} className="outline-row" data-level={h.level}>
                      <button
                        className="outline-fold"
                        onClick={() => toggleFold(h.line)}
                        disabled={!foldable}
                        aria-label={isOpen ? "Fold section" : "Unfold section"}
                        title={foldable ? (isOpen ? "Fold section" : "Unfold section") : "Nothing to fold"}
                      >
                        {foldable ? (isOpen ? "▾" : "▸") : "·"}
                      </button>
                      <button
                        className="outline-link"
                        onClick={() => jumpToLine(h.line)}
                        title={`Line ${h.line}`}
                      >
                        {h.text}
                      </button>
                    </div>
                  );
                })}
              </div>
            </nav>
          )}
          <textarea
            ref={textareaRef}
            className="source"
            value={displayContent}
            spellCheck={false}
            readOnly={isFolded}
            title={isFolded ? "Unfold to edit — folding is for navigation" : undefined}
            // Grammarly attaches to the textarea and nowhere else. It cannot
            // reach the preview iframe, which is what keeps the layers clean:
            // AI lifts sections, Grammarly polishes sentences.
            data-gramm="true"
            data-gramm_editor="true"
            data-enable-grammarly="true"
            onScroll={syncEditorToPreview}
            onKeyDown={onSourceKeyDown}
            onChange={(e) => {
              // Guarded rather than remapped: while folded the visible string
              // is a projection, so an offset-based write would corrupt the
              // buffer. Folding is navigation, not an editing mode.
              if (isFolded) return;
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
