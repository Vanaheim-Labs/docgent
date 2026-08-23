"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Vocabulary } from "@/lib/vocabulary";
import { validateMarkdown, type Diagnostic } from "@/lib/validate-client";
import { RewriteBar, type RewriteProposal } from "@/components/RewriteBar";
import { ProposalReview } from "@/components/ProposalReview";

/**
 * Auto-generate a meaningful commit message by diffing two Markdown buffers.
 * Finds which heading sections were touched and describes the change concisely.
 */
function generateCommitMessage(before: string, after: string, brand: string, slug: string): string {
  const bLines = before.split("\n");
  const aLines = after.split("\n");
  const touched = new Set<string>();
  let currentHeading = "";
  const maxLen = Math.max(bLines.length, aLines.length);
  // Walk through all lines; track headings and collect those whose content changed.
  let i = 0;
  while (i < maxLen) {
    const aLine = aLines[i] ?? "";
    const bLine = bLines[i] ?? "";
    const hm = aLine.match(/^(#{1,3})\s+(.+)/);
    if (hm) currentHeading = hm[2].replace(/\{[^}]*\}/g, "").trim();
    if (aLine !== bLine && currentHeading) touched.add(currentHeading);
    i++;
  }
  const added = aLines.length - bLines.length;
  const changed = [...touched].slice(0, 3);
  let desc: string;
  if (changed.length > 0) {
    desc = `edited ${changed.map((h) => `"${h}"`).join(", ")}`;
    if (touched.size > 3) desc += ` +${touched.size - 3} more`;
  } else {
    desc = added > 0 ? `added ${added} line${added !== 1 ? "s" : ""}` :
           added < 0 ? `removed ${-added} line${-added !== 1 ? "s" : ""}` :
           "minor edit";
  }
  return `docs(${brand}/${slug}): ${desc}`;
}

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

// Unified editor mode:
//   edit   = inline editing surface (preview as primary, both panes)
//   pages  = PDF paginated view (full width)
//   source = raw Markdown editor, source pane full width (power mode)
//   review = like edit but shows ProposalReview + comments prominently
type EditorMode = "edit" | "pages" | "source" | "review";

// Keep internal types for legacy compatibility in scroll sync logic
type PreviewMode = "html" | "pdf";
type Posture = "edit" | "review";

type Heading = { line: number; level: number; text: string };

// A folded section hides its body lines in the source while keeping the
// heading visible. Folding is a view state over the buffer: the underlying
// content is never modified, so a fold can never corrupt a document.
type Fold = { startLine: number; endLine: number };

const PALETTE_GROUPS: Record<string, string[]> = {
  All: [],
  Structure: ["summary", "appendix", "exec-intro", "pagebreak", "landscape", "columns", "toc"],
  "Data & Figures": ["datatable", "financialtable", "keyfigure", "kpigrid", "kpicard", "figure", "allocation", "funnel", "milestones", "daygrid", "timeseries", "piechart"],
  Callouts: ["callout", "pullquote", "recommendation", "definition", "signature", "note"],
};

export function Editor({ brand, slug, initialContent, initialSha, vocabulary }: Props) {
  const [content, setContent] = useState(initialContent);
  const [baseSha, setBaseSha] = useState(initialSha);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  /**
   * What changed, in the author's words.
   *
   * Left empty the store falls back to `docs(brand/slug): <title>`, which
   * stamps the document's name onto every revision — so a history of ten
   * edits reads as the same sentence ten times and Compare is the only way
   * to learn anything. Agents committing through the CLI already pass a real
   * message; this is the human path catching up.
   *
   * Not mandatory. A blocked save is worse than a vague one, and an author
   * fixing a typo should not owe anyone a sentence.
   */
  // summary removed — commit messages are auto-generated from the diff
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  // Unified editor mode. Replaces separate posture + previewMode.
  const [editorMode, setEditorMode] = useState<EditorMode>("edit");
  // Derived internal state for existing scroll sync / preview logic.
  const mode: PreviewMode = editorMode === "pages" ? "pdf" : "html";
  const posture: Posture = editorMode === "source" ? "edit" : "review";  // review/edit/pages all use review posture for preview
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pdfStale, setPdfStale] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [paletteGroup, setPaletteGroup] = useState("All");
  // Split-screen toggle (Phase 2c): show both panes side-by-side in Edit mode.
  const [splitView, setSplitView] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [folded, setFolded] = useState<number[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  /**
   * Directed rewrite: bar open state plus the scope it was opened against.
   * "scope" here is the UI's own record, not the API's Scope type — a
   * heading name for a section trigger, or a selection range for a
   * selection trigger — kept separate so getScope() below can compute the
   * API payload lazily, at request time rather than at open time.
   */
  const [rewriteTarget, setRewriteTarget] = useState<
    | { kind: "section"; heading: string; label: string; top: number }
    | { kind: "range"; start: number; end: number; label: string; top: number }
    | null
  >(null);
  const [proposal, setProposal] = useState<RewriteProposal | null>(null);
  const [acceptedNote, setAcceptedNote] = useState<string | null>(null);

  /**
   * Annotation-in-progress: which source line a Review-mode click landed on,
   * plus the draft text before it commits to the buffer. A `note` vocabulary
   * block (packages/vocabulary/vocabulary.yaml), never an HTML comment --
   * HANDOVER.md section 7b, decision 1.
   */
  const [noteTarget, setNoteTarget] = useState<{ line: number; top: number } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

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
  // True while a preview element is contenteditable — suppresses the debounced
  // re-render so the iframe doesn't replace itself while the user is typing.
  const isEditingPreview = useRef(false);
  // Scroll position to restore after a preview re-render.
  const savedPreviewScroll = useRef<number>(0);
  // Autosave: fires 3 seconds after last content change, only when dirty and no errors.
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Controls whether the "Saved ✓" indicator is visible (fades after 3s).
  const [savedVisible, setSavedVisible] = useState(false);
  const savedFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase 3a: slash command palette state
  type SlashCmd = {
    open: boolean;
    query: string;
    top: number;
    left: number;
    selectedIdx: number;
  };
  const [slashCmd, setSlashCmd] = useState<SlashCmd>({
    open: false, query: "", top: 0, left: 0, selectedIdx: 0,
  });
  const slashCmdRef = useRef(slashCmd);

  // Phase 4a: floating agent toolbar on selection
  const [selectionToolbar, setSelectionToolbar] = useState<{
    visible: boolean; top: number; left: number;
    selectedText: string;
  }>({ visible: false, top: 0, left: 0, selectedText: "" });

  // Phase 4b: command palette state
  const [cmdPalette, setCmdPalette] = useState(false);
  const [cmdQuery, setCmdQuery] = useState("");
  const [cmdSelectedIdx, setCmdSelectedIdx] = useState(0);

  // Preview zoom: percentage applied to the HTML preview body via CSS zoom.
  // Clamped to 50–200%. Driven by ⌘+scroll and pinch gestures inside the
  // iframe; stored as React state so the toolbar can display and reset it.
  const [previewZoom, setPreviewZoom] = useState(100);
  const previewZoomRef = useRef(100);

  const dirty = content !== initialContent || save.kind === "error" || save.kind === "stale";

  const diagnostics = useMemo(
    () => validateMarkdown(content, vocabulary),
    [content, vocabulary]
  );
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  // Auto-close the errors panel once all diagnostics are resolved.
  useEffect(() => {
    if (diagnostics.length === 0) setShowErrors(false);
  }, [diagnostics.length]);

  // Auto-open on mount if there are diagnostics — surfaces them immediately
  // so authors don't have to hunt for the pill after loading a document.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (diagnostics.length > 0) setShowErrors(true);
    }, 500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — runs once on mount

  /* ---------------- preview ---------------- */

  // Tracks whether a preview re-render was triggered by an inline edit blur.
  // Used to skip the re-render entirely and just leave the DOM as-is.
  const pendingPreviewAfterEdit = useRef(false);

  const runHtmlPreview = useCallback(async (src: string) => {
    if (src === lastPreviewed.current) return;
    // While the user is actively typing in the preview, suppress all re-renders.
    if (isEditingPreview.current) return;
    // If this re-render was triggered by an inline edit blur, skip it entirely.
    // The DOM already shows the correct text optimistically; a full re-render
    // would replace the iframe document and cause a scroll jump. We only do a
    // full re-render on the NEXT content change (e.g. source pane edit) or save.
    if (pendingPreviewAfterEdit.current) {
      pendingPreviewAfterEdit.current = false;
      lastPreviewed.current = src; // Mark as seen so we don’t re-render again.
      return;
    }
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
      const html = await res.text();
      setPreviewHtml(html);
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

  // Switching to Pages mode renders PDF on demand if the buffer moved since the last one.
  useEffect(() => {
    if (editorMode !== "pages") return;
    if (errors.length > 0) return;
    if (content === lastPdfRendered.current && previewUrl) return;
    runPdfPreview(content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode]);

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
        body: JSON.stringify({
          content,
          baseSha,
          // Prefixed here rather than in the field so the author writes prose,
          // not conventional-commit syntax. VersionPanel strips this same
          // prefix back off for display.
          message: generateCommitMessage(initialContent, content, brand, slug),
        }),
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
  }, [brand, slug, content, baseSha, errors.length, initialContent]);

  // Autosave: 3 seconds after last content change, when dirty and no errors.
  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    if (!dirty || errors.length > 0 || save.kind === "saving") return;
    autoSaveTimer.current = setTimeout(() => {
      doSave();
    }, 3000);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, dirty, errors.length]);

  // Show "Saved ✓" indicator for 3 seconds after a successful save.
  useEffect(() => {
    if (save.kind === "saved") {
      setSavedVisible(true);
      if (savedFadeTimer.current) clearTimeout(savedFadeTimer.current);
      savedFadeTimer.current = setTimeout(() => setSavedVisible(false), 3000);
    } else {
      setSavedVisible(false);
    }
  }, [save.kind]);

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
      // Phase 4b: ⌘K opens command palette.
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdPalette((v) => !v);
        setCmdQuery("");
        setCmdSelectedIdx(0);
      }
      // Escape closes command palette.
      if (e.key === "Escape") {
        setCmdPalette(false);
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
    // In review posture the preview is the primary surface; the source pane
    // scroll should never drive the preview position.
    if (posture === "review") return;
    if (isEditingPreview.current) return;
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
    // In review posture the preview is the primary surface; don't sync it
    // back to the source pane position.
    if (posture === "review") return;
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

  // Unfold only — same fold-removal logic as jumpToLine but without stealing
  // focus or scrolling the source textarea. Used by the preview click handler
  // so clicking a contenteditable element in a folded section doesn't hand
  // focus back to the textarea the moment the author starts typing.
  const unfoldLine = useCallback((line: number) => {
    setFolded((prev) =>
      prev.filter((f) => {
        const h = headings.find((x) => x.line === f);
        if (!h) return false;
        if (h.line === line) return false;
        return !(line > h.line && line <= sectionEnd(h));
      })
    );
  }, [headings, sectionEnd]);

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

  /* ---------------- annotation (Phase 10) ----------------
   * Review-mode click-to-annotate. Reuses the same [data-source-line]
   * anchors the scroll sync already walks, so "which line did this click
   * land on" is one function, not two competing implementations of nearest-
   * anchor lookup. Opens a one-line composer; committing writes a note
   * vocabulary block (never an HTML comment -- HANDOVER.md section 7b,
   * decision 1) on the line right after the clicked paragraph. */
  const openNoteAt = useCallback(
    (clientY: number) => {
      const win = frameRef.current?.contentWindow;
      if (!win) return;
      const all = anchors();
      if (all.length === 0) return;
      const y = clientY + win.scrollY;
      let nearest = all[0];
      let best = Infinity;
      for (const a of all) {
        const d = Math.abs(docTop(a.el, win) - y);
        if (d < best) { best = d; nearest = a; }
      }
      const top = Math.max(0, offsetForLine(nearest.line) - (textareaRef.current?.scrollTop ?? 0));
      setNoteDraft("");
      setNoteTarget({ line: nearest.line, top });
    },
    [anchors, docTop, offsetForLine]
  );

  const closeNote = useCallback(() => {
    setNoteTarget(null);
    setNoteDraft("");
  }, []);

  // Inserts the note block as its own paragraph directly after the target
  // line. A trailing blank line guarantees pandoc parses it as a new fenced
  // div rather than folding it into the preceding paragraph.
  const commitNote = useCallback(() => {
    if (!noteTarget || !noteDraft.trim()) { closeNote(); return; }
    const lines = content.split("\n");
    const insertAt = Math.min(lines.length, noteTarget.line);
    const block = ["", '::: note {author="reviewer"}', noteDraft.trim(), ":::", ""];
    lines.splice(insertAt, 0, ...block);
    const joined = lines.join("\n");
    applyEdit(joined, offsetForLine(insertAt + 1), offsetForLine(insertAt + 1));
    closeNote();
  }, [noteTarget, noteDraft, content, applyEdit, offsetForLine, closeNote]);

  /* ---------------- inline preview editing --------------------------------
   * The preview pane is the primary editing surface. Clicking any rendered
   * paragraph, heading or list item makes it contenteditable in place.
   *
   * On blur:
   *   1. The DOM element text is updated immediately (optimistic — already
   *      visible since the user just typed it).
   *   2. patchMarkdownBlock writes the new text back to the Markdown buffer,
   *      which triggers the debounced re-render and the dirty/save flow.
   *   3. The full re-render from the worker arrives ~1.2 s later and replaces
   *      the iframe content, catching any Markdown formatting side-effects.
   *
   * Code blocks are not directly editable — clicking them jumps the source
   * textarea to that line instead. Tables, callout boxes, and list items are
   * all editable in place via makeEditable. */
  const INLINE_EDITABLE_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TD", "TH"]);

  // Patch a single rendered element's text back into the Markdown buffer.
  // Handles headings (preserves hashes), bullets, numbered lists, and plain
  // paragraphs. For multi-line Markdown paragraphs the rendered element maps
  // to the first source line — the full paragraph text replaces that one line.
  const patchMarkdownBlock = useCallback((sourceLine: number, newText: string) => {
    const lines = content.split("\n");
    const idx = sourceLine - 1;
    if (idx < 0 || idx >= lines.length) return;
    const original = lines[idx];
    const headingMatch  = original.match(/^(#{1,6}\s+)/);
    const bulletMatch   = original.match(/^(\s*[-*+]\s+)/);
    const numberedMatch = original.match(/^(\s*\d+\.\s+)/);
    let prefix = "";
    if (headingMatch)       prefix = headingMatch[1];
    else if (bulletMatch)   prefix = bulletMatch[1];
    else if (numberedMatch) prefix = numberedMatch[1];
    lines[idx] = prefix + newText.trim();
    applyEdit(lines.join("\n"), 0, 0);
  }, [content, applyEdit]);

  // Make a rendered preview element editable. Called on click.
  const makeEditable = useCallback((el: HTMLElement) => {
    const sourceLine   = Number(el.dataset.sourceLine);
    const originalText = el.innerText;

    // Mark editing active BEFORE focus so the debounced re-render is
    // suppressed immediately — not after the first timer fires.
    isEditingPreview.current = true;

    // Prevent focus() from scrolling the element into view, which causes
    // the page-jump. Save the iframe scroll position, focus, then restore.
    const win = frameRef.current?.contentWindow;
    const scrollBefore = win?.scrollY ?? 0;
    el.contentEditable = "true";
    el.focus({ preventScroll: true });
    // preventScroll is not supported in all browsers; belt-and-suspenders.
    if (win && win.scrollY !== scrollBefore) {
      win.scrollTo({ top: scrollBefore, behavior: "instant" as ScrollBehavior });
    }

    const handleKeydown = (ke: KeyboardEvent) => {
      if (ke.key === "Escape") {
        el.innerText = originalText;
        el.removeEventListener("keydown", handleKeydown);
        el.blur();
      } else if (
        ke.key === "Enter" && !ke.shiftKey &&
        el.tagName !== "P" && el.tagName !== "LI"
      ) {
        ke.preventDefault();
        el.removeEventListener("keydown", handleKeydown);
        el.blur();
      }
    };

    const handleBlur = () => {
      el.removeEventListener("keydown", handleKeydown);
      el.contentEditable = "false";
      el.contentEditable = "false";
      const edited = el.innerText;
      if (edited.trim() !== originalText.trim()) {
        // Set the flag BEFORE clearing isEditingPreview so that
        // syncEditorToPreview stays suppressed through the entire
        // applyEdit -> textarea scroll -> sync cycle.
        pendingPreviewAfterEdit.current = true;
        patchMarkdownBlock(sourceLine, edited);
      }
      // Clear AFTER patchMarkdownBlock so syncEditorToPreview is still
      // blocked when applyEdit triggers the textarea scroll event.
      // Use rAF to let the scroll event fire and be swallowed first.
      requestAnimationFrame(() => {
        isEditingPreview.current = false;
      });
    };

    el.addEventListener("blur",    handleBlur,    { once: true });
    el.addEventListener("keydown", handleKeydown);
  }, [patchMarkdownBlock]);

  // Inject zoom gesture handlers into the iframe document.
  //
  // Intercepts ⌘+scroll (wheel with metaKey) and the non-standard GestureEvent
  // (Safari pinch) on the iframe's own document, prevents the browser from
  // treating them as a viewport zoom, and instead applies CSS zoom to
  // document.body directly. Same-origin iframes let us do this without any
  // postMessage indirection.
  //
  // Why body.style.zoom and not transform: scale()?
  // CSS zoom reflows the document at the new logical width, so text wraps
  // and columns resize exactly like Word / Google Docs. transform: scale()
  // just scales pixels — layout stays fixed and the pane gets scroll bars.
  //
  // Re-injected on every iframe load (previewHtml change) because srcDoc
  // replaces the entire document and the listeners are lost.
  const injectZoomHandlers = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || doc.getElementById("__docgent_zoom")) return;

    // Marker so we don't double-inject.
    const marker = doc.createElement("meta");
    marker.id = "__docgent_zoom";
    doc.head.appendChild(marker);

    // Wheel: ⌘+scroll (standard cross-browser zoom gesture on Mac).
    doc.addEventListener("wheel", (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      // deltaY is negative for zoom-in (scroll up), positive for zoom-out.
      // A typical trackpad notch is ~3–4 px; cap sensitivity.
      const delta = -e.deltaY * 0.15;
      const next = Math.min(200, Math.max(50, previewZoomRef.current + delta));
      previewZoomRef.current = next;
      setPreviewZoom(Math.round(next));
      if (doc.body) doc.body.style.zoom = String(next / 100);
    }, { passive: false });

    // GestureEvent: Safari pinch-to-zoom (non-standard but widely used on Mac).
    // The gesturechange event fires continuously; scale is the cumulative
    // gesture scale relative to when the gesture started, not a delta.
    let gestureStartZoom = previewZoomRef.current;
    doc.addEventListener("gesturestart", () => {
      gestureStartZoom = previewZoomRef.current;
    });
    doc.addEventListener("gesturechange", (e: Event) => {
      const ge = e as unknown as { scale: number };
      e.preventDefault();
      const next = Math.min(200, Math.max(50, gestureStartZoom * ge.scale));
      previewZoomRef.current = next;
      setPreviewZoom(Math.round(next));
      if (doc.body) doc.body.style.zoom = String(next / 100);
    });
    doc.addEventListener("gestureend", (e: Event) => {
      e.preventDefault();
    });

    // Apply the current zoom immediately in case we're re-injecting after
    // a preview reload that reset the body style.
    if (doc.body && previewZoomRef.current !== 100) {
      doc.body.style.zoom = String(previewZoomRef.current / 100);
    }
  }, []);

  // Inject a hover cursor into the iframe document so editable elements show
  // a text cursor on mouseover, making the surface discoverable.
  const injectEditCursor = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || doc.getElementById("__docgent_edit_cursor")) return;
    const style = doc.createElement("style");
    style.id = "__docgent_edit_cursor";
    style.textContent = [
      "p[data-source-line], h1[data-source-line], h2[data-source-line],",
      "h3[data-source-line], h4[data-source-line], h5[data-source-line],",
      "h6[data-source-line], li[data-source-line], td, th { cursor: text; }",
      "p[data-source-line]:hover, h1[data-source-line]:hover, h2[data-source-line]:hover,",
      "h3[data-source-line]:hover, h4[data-source-line]:hover, h5[data-source-line]:hover,",
      "h6[data-source-line]:hover, li[data-source-line]:hover, td:hover, th:hover {",
      "  background: rgba(99,102,241,0.06); border-radius: 3px; outline: 1px solid rgba(99,102,241,0.2);",
      "}",
      ".src-anchor:hover > p, .src-anchor:hover > li { background: rgba(99,102,241,0.06); border-radius: 3px; outline: 1px solid rgba(99,102,241,0.2); }",
    ].join(" ");
    doc.head.appendChild(style);
  }, []);

  // Stable refs so the iframe click handler never goes stale when React
  // state changes. Updated synchronously on every render.
  const postureRef    = useRef<Posture>(posture);
  const makeEditableRef = useRef(makeEditable);
  const openNoteAtRef   = useRef(openNoteAt);
  const anchorsRef      = useRef(anchors);
  const docTopRef       = useRef(docTop);
  const jumpToLineRef   = useRef(jumpToLine);
  const unfoldLineRef   = useRef(unfoldLine);
  const doSaveRef       = useRef(doSave);
  postureRef.current    = posture;
  makeEditableRef.current = makeEditable;
  openNoteAtRef.current   = openNoteAt;
  anchorsRef.current      = anchors;
  docTopRef.current       = docTop;
  jumpToLineRef.current   = jumpToLine;
  unfoldLineRef.current   = unfoldLine;
  doSaveRef.current       = doSave;

  // Stable keydown handler for the iframe document — intercepts ⌘S/Ctrl+S so
  // the browser's native Save dialog never appears when focus is in the preview.
  const iframeSaveHandler = useRef<((e: KeyboardEvent) => void) | null>(null);
  if (!iframeSaveHandler.current) {
    iframeSaveHandler.current = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        doSaveRef.current();
      }
    };
  }

  // Stable click handler — created once, reads current values via refs.
  const iframeClickHandler = useRef<((e: MouseEvent) => void) | null>(null);
  if (!iframeClickHandler.current) {
    iframeClickHandler.current = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const frame  = frameRef.current;
      if (!target || !frame) return;
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      if (!doc || !win) return;

      // Walk up to find an editable element.
      //
      // Cases:
      //   1. Headings (h2–h6) / TD / TH: data-source-line is stamped directly
      //      on the element by the Lua filter.
      //   2. Paragraphs: the Lua filter wraps them in a src-anchor div.
      //   3. List items: the Lua filter wraps the entire <ul>/<ol> in a single
      //      src-anchor div, so we must resolve to the specific <li> clicked,
      //      not the first child of the wrapper.
      //   4. Callout boxes / fenced divs: inner paragraphs are wrapped in
      //      src-anchor divs inside the callout — same as case 2.
      //   5. h1 headings: the Lua filter wraps them in a section-opener div
      //      with no data-source-line on the <h1> itself. We detect the
      //      section-opener parent and use the nearest heading as the edit
      //      target, borrowing the line from the next src-anchor sibling.
      //   6. Table cells: borrow data-source-line from nearest TR/TABLE
      //      ancestor when the cell itself has no line stamp.

      // Pre-pass: if we clicked inside a <li>, resolve it first (case 3) so
      // the upward walk doesn’t accidentally grab a src-anchor before we
      // identify the right list item.
      let clickedLi: HTMLElement | null = null;
      {
        let t: HTMLElement | null = target;
        while (t && t !== doc.body) {
          if (t.tagName === "LI") { clickedLi = t; break; }
          t = t.parentElement;
        }
      }

      let editEl: HTMLElement | null = null;
      let el: HTMLElement | null = target;
      while (el && el !== doc.body) {
        if (INLINE_EDITABLE_TAGS.has(el.tagName) && el.dataset.sourceLine) {
          // Case (1): element directly carries source line.
          editEl = el;
          break;
        }
        if (el.dataset.sourceLine && el.classList.contains("src-anchor")) {
          if (clickedLi) {
            // Case (3): list item — use the specific <li> clicked, not the
            // first child of the wrapper.
            if (!clickedLi.dataset.sourceLine) {
              clickedLi.dataset.sourceLine = el.dataset.sourceLine;
            }
            editEl = clickedLi;
          } else {
            // Case (2)/(4): paragraph / callout — first editable child.
            const child = el.querySelector<HTMLElement>(
              "p, h1, h2, h3, h4, h5, h6"
            );
            if (child) {
              if (!child.dataset.sourceLine) {
                child.dataset.sourceLine = el.dataset.sourceLine;
              }
              editEl = child;
            }
          }
          break;
        }
        // Case (5): h1 inside a section-opener div. The Lua filter generates
        //   <div class="section-opener">...<h1 class="section-h1">...</h1></div>
        // with no data-source-line on the h1. Find the source line from the
        // next sibling src-anchor after the section-opener.
        if (el.classList.contains("section-opener")) {
          const h1 = el.querySelector<HTMLElement>("h1");
          if (h1) {
            // Look for the nearest following src-anchor sibling to borrow its line.
            let sib = el.nextElementSibling as HTMLElement | null;
            while (sib) {
              if (sib.dataset.sourceLine) {
                h1.dataset.sourceLine = sib.dataset.sourceLine;
                break;
              }
              sib = sib.nextElementSibling as HTMLElement | null;
            }
            if (h1.dataset.sourceLine) {
              editEl = h1;
              break;
            }
          }
        }
        // Case (6): table cell — borrow data-source-line from nearest ancestor.
        if ((el.tagName === "TD" || el.tagName === "TH") && !el.dataset.sourceLine) {
          let ancestor: HTMLElement | null = el.parentElement;
          while (ancestor && ancestor !== doc.body) {
            if (ancestor.dataset.sourceLine) {
              el.dataset.sourceLine = ancestor.dataset.sourceLine;
              break;
            }
            ancestor = ancestor.parentElement;
          }
          if (el.dataset.sourceLine) {
            editEl = el;
            break;
          }
        }
        el = el.parentElement;
      }

      if (editEl) {
        e.preventDefault();
        // If a section containing this line is folded, remove the fold so the
        // source textarea is no longer read-only. Use unfoldLine (not
        // jumpToLine) so focus is NOT moved to the textarea — jumpToLine calls
        // el.focus() in a rAF, which would steal focus back from the
        // contenteditable element the moment the author starts typing.
        const srcLine = Number(editEl.dataset.sourceLine);
        if (srcLine > 0) unfoldLineRef.current(srcLine);
        makeEditableRef.current(editEl);
        return;
      }

      // Non-editable click — in review posture just ignore it (clicking a
      // table or figure shouldn't move anything). In source posture, jump
      // to the nearest source line so the textarea scrolls to context.
      if (postureRef.current === "edit") {
        const all = anchorsRef.current();
        if (all.length === 0) return;
        const y = e.clientY + win.scrollY;
        let nearest = all[0];
        let best = Infinity;
        for (const a of all) {
          const d = Math.abs(docTopRef.current(a.el, win) - y);
          if (d < best) { best = d; nearest = a; }
        }
        jumpToLineRef.current(nearest.line);
      }
    };
  }

  // Attach the stable click handler and cursor styles once when the iframe
  // loads, and re-attach after each full preview HTML reload.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const handler = iframeClickHandler.current!;

    const attach = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      // Remove any prior copy before adding (idempotent).
      doc.removeEventListener("click", handler);
      doc.addEventListener("click", handler);
      injectEditCursor();
      injectZoomHandlers();
    };

    // Re-attach every time the iframe navigates to new HTML.
    frame.addEventListener("load", attach);
    // Also attach immediately if already loaded.
    attach();

    return () => {
      frame.removeEventListener("load", attach);
      frame.contentDocument?.removeEventListener("click", handler);
    };
  // Only re-run when the iframe element itself changes or HTML reloads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewHtml]);

  // Wrapper div click — events are handled inside the iframe directly.
  const onPreviewClick = useCallback(
    (_e: React.MouseEvent<HTMLDivElement>) => { /* handled by iframe listener */ },
    []
  );

  // Phase 4a: selection toolbar — show floating toolbar when text is selected in preview.
  useEffect(() => {
    if (editorMode !== "edit") return;
    const frame = frameRef.current;
    if (!frame) return;

    const handleSelection = () => {
      const win = frame.contentWindow;
      if (!win) return;
      const sel = win.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelectionToolbar((s) => s.visible ? { ...s, visible: false } : s);
        return;
      }
      const text = sel.toString().trim();
      if (!text) { setSelectionToolbar((s) => s.visible ? { ...s, visible: false } : s); return; }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      setSelectionToolbar({
        visible: true,
        // Position above the selection, relative to the viewport
        top: frameRect.top + rect.top - 44,
        left: frameRect.left + rect.left + rect.width / 2,
        selectedText: text,
      });
    };

    const attach = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      doc.addEventListener("selectionchange", handleSelection);
    };
    attach();
    frame.addEventListener("load", attach);
    return () => {
      frame.removeEventListener("load", attach);
      frame.contentDocument?.removeEventListener("selectionchange", handleSelection);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewHtml, editorMode]);

  /* ---------------- directed rewrite ---------------- */

  // Opens the bar against the current textarea selection. Refuses an empty
  // selection rather than silently falling back to the whole document — a
  // human who selected nothing almost certainly meant to select something,
  // and "rewrite everything" from an empty selection is the kind of surprise
  // that erodes trust in the feature on first use.
  const openSelectionRewrite = useCallback(() => {
    const el = textareaRef.current;
    if (!el || isFolded) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (end <= start) return;
    const selected = content.slice(start, end);
    const label =
      selected.trim().length > 60 ? selected.trim().slice(0, 57) + "…" : selected.trim();
    const top = Math.max(0, offsetForLine(content.slice(0, start).split("\n").length) - el.scrollTop);
    setProposal(null);
    setAcceptedNote(null);
    setRewriteTarget({ kind: "range", start, end, label: label || "selection", top });
  }, [content, isFolded, offsetForLine]);

  // Opens the bar against a whole section, addressed by heading text so it
  // survives a reorder between opening the bar and the request landing.
  const openSectionRewrite = useCallback(
    (h: Heading) => {
      const top = Math.max(0, offsetForLine(h.line) - (textareaRef.current?.scrollTop ?? 0));
      setProposal(null);
      setAcceptedNote(null);
      setRewriteTarget({ kind: "section", heading: h.text, label: h.text, top });
    },
    [offsetForLine]
  );

  const closeRewrite = useCallback(() => {
    setRewriteTarget(null);
    setProposal(null);
  }, []);

  /* ---------------- strike ----------------
   * Deterministic text transform, not a serialiser (HANDOVER.md section 7b,
   * decision 2): toggles a .struck class in the heading's own pandoc
   * attribute block. A heading with no block gets one added; the body is
   * never touched, so strike is trivially undoable and commits only on
   * save, same as any other edit. */
  const isStruck = useCallback(
    (h: Heading): boolean => {
      const line = content.split("\n")[h.line - 1] ?? "";
      const attrs = line.match(/\{([^}]*)\}\s*$/)?.[1] ?? "";
      return /(^|\s)\.struck(\s|$)/.test(attrs);
    },
    [content]
  );

  const toggleStrike = useCallback(
    (h: Heading) => {
      const lines = content.split("\n");
      const line = lines[h.line - 1] ?? "";
      const attrMatch = line.match(/^(#{1,6}\s+.*?)\s*\{([^}]*)\}\s*$/);
      let next: string;
      if (attrMatch) {
        const head = attrMatch[1];
        const attrs = attrMatch[2];
        const already = /(^|\s)\.struck(\s|$)/.test(attrs);
        const nextAttrs = already
          ? attrs.replace(/(^|\s)\.struck(\s|$)/, " ").trim()
          : (attrs.trim() + " .struck").trim();
        next = nextAttrs ? head + " {" + nextAttrs + "}" : head;
      } else {
        const m = line.match(/^(#{1,6}\s+.*\S)\s*$/);
        next = m ? m[1] + " {.struck}" : line;
      }
      lines[h.line - 1] = next;
      const joined = lines.join("\n");
      const pos = offsetForLine(h.line);
      applyEdit(joined, pos, pos + next.length);
    },
    [content, applyEdit, offsetForLine]
  );

  /* ---------------- reorder ----------------
   * Also a deterministic text transform (HANDOVER.md section 7b, decision
   * 2): each same-level section (heading line through the line before the
   * next heading of equal-or-shallower level) is extracted as a contiguous
   * string and the buffer is reassembled with sections in the requested
   * order. Content is never parsed into a tree -- this is string slicing
   * plus concatenation, safe against nesting and adjacent fenced divs by
   * construction (a section's fenced divs are wholly inside its own slice,
   * since sectionEnd already respects heading boundaries).
   */
  const moveSection = useCallback(
    (fromLine: number, toLine: number) => {
      if (fromLine === toLine) return;
      const from = headings.find((h) => h.line === fromLine);
      const to = headings.find((h) => h.line === toLine);
      if (!from || !to || from.level !== to.level) return;

      const lines = content.split("\n");
      const slice = (h: Heading) => {
        const end = sectionEnd(h);
        return lines.slice(h.line - 1, end).join("\n");
      };

      // Only resequence among same-level headings, since a section's own
      // subsections travel with it inside its slice -- reordering across
      // levels would be ambiguous about where the moved block nests.
      const peers = headings.filter((h) => h.level === from.level);
      const order = peers.map((h) => h.line);
      const fromIdx = order.indexOf(fromLine);
      const toIdx = order.indexOf(toLine);
      if (fromIdx === -1 || toIdx === -1) return;
      const moved = order.splice(fromIdx, 1)[0];
      order.splice(toIdx, 0, moved);

      const peerSlices = new Map(peers.map((h) => [h.line, slice(h)]));
      const orderedText = order.map((line) => peerSlices.get(line)).join("\n");

      const firstPeer = peers[0];
      const lastPeer = peers[peers.length - 1];
      const before = lines.slice(0, firstPeer.line - 1).join("\n");
      const after = lines.slice(sectionEnd(lastPeer)).join("\n");

      const rejoined = [before, orderedText, after].filter((s) => s.length > 0).join("\n");
      applyEdit(rejoined, 0, 0);
    },
    [content, headings, sectionEnd, applyEdit]
  );

  // Resolved lazily inside RewriteBar, at request time — never at open time —
  // so a proposal always reflects what is currently selected/scoped, not a
  // stale snapshot from when the bar first appeared.
  const getScope = useCallback(():
    | { kind: "section"; heading: string }
    | { kind: "range"; start: number; end: number } => {
    if (!rewriteTarget) return { kind: "range", start: 0, end: 0 };
    if (rewriteTarget.kind === "section") return { kind: "section", heading: rewriteTarget.heading };
    return { kind: "range", start: rewriteTarget.start, end: rewriteTarget.end };
  }, [rewriteTarget]);

  // Accepting a proposal goes through the exact same primitive every
  // formatting button uses, so undo, dirty-state and preview invalidation
  // behave identically for an AI-authored change and a hand-typed one.
  const acceptProposal = useCallback(
    (finalContent: string, accepted: RewriteProposal) => {
      applyEdit(finalContent, accepted.span.start, accepted.span.start + accepted.after.length);
      setBaseSha((prev) => prev); // server already advanced baseSha via the accept commit
      setAcceptedNote(`Accepted — ${accepted.model.label}: “${accepted.instruction}”`);
      setProposal(null);
      setRewriteTarget(null);
      // The accept endpoint already committed, so the buffer and the repo
      // agree the moment applyEdit lands — nothing further to save.
    },
    [applyEdit]
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
          opener,
        };
      }),
    [vocabulary]
  );

  // Keep slashCmdRef in sync so keydown handler reads current value.
  slashCmdRef.current = slashCmd;

  /* Phase 3a: slash command helpers */

  // Compute approximate {top, left} of cursor in the textarea using a mirror div.
  const getCursorPos = useCallback((): { top: number; left: number } => {
    const el = textareaRef.current;
    if (!el) return { top: 0, left: 0 };
    const pos = el.selectionStart;
    const cs = getComputedStyle(el);
    const mirror = document.createElement("div");
    Object.assign(mirror.style, {
      position: "absolute", visibility: "hidden", pointerEvents: "none",
      top: "0", left: "-9999px", whiteSpace: "pre-wrap",
      wordBreak: cs.wordBreak, overflowWrap: cs.overflowWrap,
      font: cs.font, fontFamily: cs.fontFamily, fontSize: cs.fontSize,
      lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing,
      tabSize: cs.tabSize, padding: cs.padding,
      boxSizing: cs.boxSizing, width: `${el.offsetWidth}px`,
    });
    const before = document.createElement("span");
    before.textContent = el.value.slice(0, pos);
    const cursor = document.createElement("span");
    cursor.textContent = "|";
    mirror.appendChild(before);
    mirror.appendChild(cursor);
    document.body.appendChild(mirror);
    const rect = cursor.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    document.body.removeChild(mirror);
    return {
      top: rect.top - elRect.top - el.scrollTop + rect.height,
      left: rect.left - elRect.left,
    };
  }, []);

  // Close slash menu.
  const closeSlashMenu = useCallback(() => {
    setSlashCmd((s) => ({ ...s, open: false, query: "", selectedIdx: 0 }));
  }, []);

  // Filter snippets by slash query.
  const slashFiltered = useMemo(() => {
    if (!slashCmd.query) return snippets;
    const q = slashCmd.query.toLowerCase();
    return snippets.filter(
      (s) => s.id.includes(q) || s.description.toLowerCase().includes(q)
    );
  }, [snippets, slashCmd.query]);

  // Insert a snippet from the slash menu, removing the slash trigger.
  const insertFromSlash = useCallback((s: { snippet: string }) => {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart;
    // Find start of current "/query" on the current line.
    const lineStart = content.lastIndexOf("\n", pos - 1) + 1;
    const lineText = content.slice(lineStart, pos);
    const slashIdx = lineText.lastIndexOf("/");
    const removeFrom = lineStart + (slashIdx >= 0 ? slashIdx : 0);
    const body = "Content goes here.";
    const text = s.snippet.replace("$BODY$", body);
    const next = content.slice(0, removeFrom) + text + content.slice(pos);
    setContent(next);
    closeSlashMenu();
    requestAnimationFrame(() => {
      el.focus();
      const cursor = removeFrom + text.indexOf(body);
      el.setSelectionRange(cursor, cursor + body.length);
    });
  }, [content, closeSlashMenu]);

  // Keyboard shortcuts for the marks authors reach for most. Registered on the
  // textarea rather than the window so they cannot hijack typing elsewhere.
  const onSourceKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Phase 3a: slash menu navigation takes priority.
      if (slashCmdRef.current.open) {
        if (e.key === "Escape") { e.preventDefault(); closeSlashMenu(); return; }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashCmd((s) => ({ ...s, selectedIdx: Math.min(s.selectedIdx + 1, slashFiltered.length - 1) }));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashCmd((s) => ({ ...s, selectedIdx: Math.max(0, s.selectedIdx - 1) }));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const item = slashFiltered[slashCmdRef.current.selectedIdx];
          if (item) insertFromSlash(item);
          return;
        }
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "b") { e.preventDefault(); toggleInline("**", "bold text"); }
      else if (k === "i") { e.preventDefault(); toggleInline("*", "italic text"); }
      else if (k === "e") { e.preventDefault(); toggleInline("\`", "code"); }
      else if (k === "k") { e.preventDefault(); insertLink(); }
    },
    [toggleInline, insertLink, closeSlashMenu, insertFromSlash, slashFiltered]
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

  /* ---------------- render ---------------- */

  const lineCount = content.split("\n").length;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <div className="editor-toolbar-left">
          <button
            className={`btn ${showPalette ? "btn-primary" : "btn-secondary"} palette-trigger`}
            onClick={() => setShowPalette((v) => !v)}
            title="Insert a Docgent block (⌘/)"
            aria-expanded={showPalette}
          >
            + Add <kbd>⌘/</kbd>
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setShowOutline((v) => !v)}
            data-active={showOutline}
            title="Toggle document outline"
          >
            ☰ Outline
          </button>
          {/* Phase 2c: split-screen toggle in Edit and Review mode */}
          {(editorMode === "edit" || editorMode === "review") && (
            <button
              className="btn btn-secondary"
              onClick={() => setSplitView((v) => !v)}
              data-active={splitView}
              title="Toggle split source/preview view"
            >
              ⋯ Split
            </button>
          )}
          {/* Unified 4-button mode switcher (Phase 5b adds Review) */}
          <div className="mode-toggle" role="group" aria-label="Editor mode">
            <button
              className="mode-btn"
              data-active={editorMode === "edit"}
              onClick={() => setEditorMode("edit")}
              title="Edit in the preview — click any paragraph or heading to edit it directly"
            >
              Edit
            </button>
            <button
              className="mode-btn"
              data-active={editorMode === "review"}
              onClick={() => setEditorMode("review")}
              title="Review — agent suggestions, comments and diff review"
            >
              Review
            </button>
            <button
              className="mode-btn"
              data-active={editorMode === "pages"}
              onClick={() => setEditorMode("pages")}
              title="Paginated PDF — exact print fidelity"
            >
              Pages{pdfStale && editorMode === "pages" ? " •" : ""}
            </button>
            <button
              className="mode-btn source-mode-btn"
              data-active={editorMode === "source"}
              onClick={() => setEditorMode("source")}
              title="Source — edit raw Markdown directly (power mode)"
            >
              ‹› Source
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
          {/* Zoom indicator — only in HTML preview modes */}
          {editorMode !== "pages" && editorMode !== "source" && previewZoom !== 100 && (
            <button
              className="zoom-indicator"
              onClick={() => {
                previewZoomRef.current = 100;
                setPreviewZoom(100);
                const doc = frameRef.current?.contentDocument;
                if (doc?.body) doc.body.style.zoom = "1";
              }}
              title="Reset zoom to 100%"
            >
              {previewZoom}% ↺
            </button>
          )}
          {editorMode === "pages" ? (
            <>
              <button
                className="btn btn-secondary"
                onClick={() => setEditorMode("edit")}
                title="Return to editing"
              >
                ← Edit document
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => runPdfPreview(content)}
                disabled={previewing || errors.length > 0}
              >
                {previewing ? "Generating…" : pdfStale ? "Refresh PDF" : "Refresh PDF"}
              </button>
              {previewUrl && !previewing && (
                <a
                  className="btn"
                  href={previewUrl}
                  download={`${slug}.pdf`}
                  title="Download PDF"
                >
                  ↓ Download PDF
                </a>
              )}
            </>
          ) : (
            <button
              className="btn btn-secondary"
              onClick={() => setEditorMode("pages")}
              title="Generate and download PDF"
              disabled={errors.length > 0}
            >
              Export PDF
            </button>
          )}
          {previewing && editorMode === "pages" && <span className="editor-stat">generating PDF…</span>}
          {/* Health pill — collapses to one item, always right of Export */}
          {errors.length > 0 ? (
            <button
              className="diag-pill diag-pill-btn"
              data-severity="error"
              onClick={() => setShowErrors((v) => !v)}
              title={showErrors ? "Hide errors" : "Show all errors"}
              aria-expanded={showErrors}
            >
              ✕ {errors.length} error{errors.length > 1 ? "s" : ""}
            </button>
          ) : warnings.length > 0 ? (
            <button
              className="diag-pill diag-pill-btn"
              data-severity="warning"
              onClick={() => setShowErrors((v) => !v)}
              title={showErrors ? "Hide warnings" : "Show all warnings"}
              aria-expanded={showErrors}
            >
              ⚠ {warnings.length} warning{warnings.length > 1 ? "s" : ""}
            </button>
          ) : (
            <span className="diag-pill" data-severity="ok">✓ healthy</span>
          )}

          {/* Autosave status — replaces the Save button entirely */}
          {save.kind === "saving" ? (
            <span className="autosave-status" data-state="saving">Saving…</span>
          ) : save.kind === "error" ? (
            <button className="autosave-status" data-state="error" onClick={doSave} title="Click to retry">
              ⚠ Save failed
            </button>
          ) : save.kind === "stale" ? (
            <button className="autosave-status" data-state="stale" onClick={() => window.location.reload()}>
              ⚠ Conflict
            </button>
          ) : savedVisible ? (
            <span className="autosave-status" data-state="saved">Saved ✓</span>
          ) : null}
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

        <div className="format-group">
          <button
            className="format-btn format-btn-wide"
            onClick={openSelectionRewrite}
            disabled={isFolded}
            title="Select text first, then direct a rewrite"
            aria-label="Rewrite selection"
          >
            ✨ Rewrite
          </button>
        </div>

        {isFolded && (
          <span className="format-note">unfold a section to edit</span>
        )}
      </div>

      {showPalette && (
        <div className="palette">
          <div className="palette-head">
            Insert block
          </div>
          <div className="palette-groups">
            {Object.keys(PALETTE_GROUPS).map((g) => (
              <button
                key={g}
                className="palette-group-btn"
                data-active={paletteGroup === g}
                onClick={() => setPaletteGroup(g)}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="palette-grid">
            {snippets
              .filter((s) =>
                paletteGroup === "All" ||
                (PALETTE_GROUPS[paletteGroup] ?? []).includes(s.id)
              )
              .map((s) => (
                <button key={s.id} className="palette-item" onClick={() => insertSnippet(s.snippet)}>
                  <span className="palette-item-id">{s.id}</span>
                  <span className="palette-item-syntax">{s.opener}</span>
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
      {/* Saved confirmation is now shown inline in the toolbar as autosave-status. */}
      {acceptedNote && (
        <div className="banner" data-kind="ok">
          {acceptedNote} — committed. Save is not needed for this change.
        </div>
      )}

      {rewriteTarget && !proposal && (
        <RewriteBar
          brand={brand}
          slug={slug}
          scopeLabel={rewriteTarget.label}
          getScope={getScope}
          onProposal={setProposal}
          onClose={closeRewrite}
          anchorTop={rewriteTarget.top}
        />
      )}

      {proposal && (
        <div className="proposal-overlay">
          <ProposalReview
            proposal={proposal}
            brand={brand}
            slug={slug}
            onAccept={acceptProposal}
            onReject={closeRewrite}
          />
        </div>
      )}

      {showErrors && diagnostics.length > 0 && (
        <div className="errors-panel" role="alert" aria-label="Document diagnostics">
          <div className="errors-panel-header">
            <span className="errors-panel-title">
              {errors.length > 0 ? (
                <>
                  <span className="errors-panel-icon" data-severity="error">✕</span>
                  {errors.length} error{errors.length !== 1 ? "s" : ""}
                  {warnings.length > 0 ? `, ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}` : ""}
                </>
              ) : (
                <>
                  <span className="errors-panel-icon" data-severity="warning">⚠</span>
                  {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
                </>
              )}
            </span>
            <button
              className="errors-panel-close"
              onClick={() => setShowErrors(false)}
              aria-label="Close diagnostics panel"
            >
              ✕
            </button>
          </div>
          <div className="errors-panel-body">
            {diagnostics.map((d, i) => (
              <button
                key={i}
                className="errors-panel-row"
                data-severity={d.severity}
                onClick={() => { jumpToLine(d.line); setShowErrors(false); }}
                title={`Jump to line ${d.line}`}
              >
                <span className="errors-panel-severity">{d.severity === "error" ? "E" : "W"}</span>
                <span className="errors-panel-lineno">L{d.line}</span>
                <span className="errors-panel-msg">{d.message}</span>
              </button>
            ))}
          </div>
          <div className="errors-panel-footer">
            Click any row to jump to that line
          </div>
        </div>
      )}

      {noteTarget && (
        <div className="note-composer" style={{ top: noteTarget.top }} role="dialog" aria-label="Add a note">
          <div className="note-composer-head">
            <span>Note — line {noteTarget.line}</span>
            <button className="note-composer-close" onClick={closeNote} aria-label="Cancel">×</button>
          </div>
          <textarea
            className="note-composer-input"
            autoFocus
            rows={2}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Direction for the next pass — e.g. &quot;shorter, cut the second example&quot;"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                commitNote();
              }
              if (e.key === "Escape") closeNote();
            }}
          />
          <div className="note-composer-actions">
            <button className="btn btn-secondary" onClick={closeNote}>Cancel</button>
            <button className="btn" onClick={commitNote} disabled={!noteDraft.trim()}>
              Add note <kbd>⌘⏎</kbd>
            </button>
          </div>
        </div>
      )}

      <div
        className="editor-panes"
        data-posture={posture}
        data-mode={editorMode}
        data-split={(splitView && editorMode === "edit") || (splitView && editorMode === "review")}
      >
        {/* Collapsible outline sidebar (Phase 2b) */}
        {showOutline && headings.length > 0 && (
          <nav
            className="outline-sidebar"
            data-open="true"
            aria-label="Document outline"
          >
            <div className="outline-head" style={{ position: "sticky", top: 0, zIndex: 1 }}>
              <span>Outline</span>
              <span className="outline-count">{headings.length}</span>
            </div>
            <div className="outline-list">
              {headings.map((h) => {
                const foldable = sectionEnd(h) > h.line;
                const isOpen = !folded.includes(h.line);
                const struck = isStruck(h);
                return (
                  <div
                    key={h.line}
                    className="outline-row"
                    data-level={h.level}
                    data-struck={struck}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/x-docgent-line", String(h.line));
                      e.dataTransfer.setData("text/x-docgent-level", String(h.level));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes("text/x-docgent-line")) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(e) => {
                      const fromLine = Number(e.dataTransfer.getData("text/x-docgent-line"));
                      if (!Number.isFinite(fromLine) || fromLine === h.line) return;
                      e.preventDefault();
                      moveSection(fromLine, h.line);
                    }}
                    title="Drag to reorder"
                  >
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
                      title={`${h.text} — line ${h.line}`}
                    >
                      {h.text}
                    </button>
                    <button
                      className="outline-strike"
                      onClick={() => toggleStrike(h)}
                      data-active={struck}
                      title={struck ? "Unstrike section" : "Strike section"}
                      aria-label={struck ? `Unstrike ${h.text}` : `Strike ${h.text}`}
                    >
                      S
                    </button>
                    <button
                      className="outline-direct"
                      onClick={() => openSectionRewrite(h)}
                      title={`Direct a rewrite of "${h.text}"`}
                      aria-label={`Direct a rewrite of ${h.text}`}
                    >
                      ✨
                    </button>
                  </div>
                );
              })}
            </div>
          </nav>
        )}
        {/* Source pane: shown in Source mode always, in Edit+split mode when split is on */}
        {/* Source pane: shown in Source mode always, in Edit+split mode when split is on */}
        {(editorMode === "source" || (editorMode === "edit" && splitView) || (editorMode === "review" && splitView)) && (
        <div className="pane pane-source">
          {editorMode === "source" && (
            <div className="source-mode-banner">
              ‹› You are editing the document source
            </div>
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
              const val = e.target.value;
              setContent(val);
              if (save.kind === "saved") setSave({ kind: "idle" });
              // Phase 3a: slash command detection.
              // Detect "/" followed by optional query on the current line.
              const el = e.target;
              const pos = el.selectionStart;
              const lineStart = val.lastIndexOf("\n", pos - 1) + 1;
              const lineText = val.slice(lineStart, pos);
              const slashMatch = lineText.match(/^\/([a-zA-Z0-9_-]*)$/);
              if (slashMatch) {
                const { top, left } = getCursorPos();
                setSlashCmd({ open: true, query: slashMatch[1], top, left, selectedIdx: 0 });
              } else {
                setSlashCmd((s) => s.open ? { ...s, open: false, query: "", selectedIdx: 0 } : s);
              }
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
          {/* Phase 3a: slash command palette */}
          {slashCmd.open && slashFiltered.length > 0 && (
            <div
              className="slash-menu"
              style={{ top: slashCmd.top, left: Math.max(0, slashCmd.left) }}
              role="listbox"
              aria-label="Insert block"
            >
              {slashCmd.query && (
                <div className="slash-menu-search">
                  Searching: /{slashCmd.query}
                </div>
              )}
              {slashFiltered.slice(0, 20).map((s, i) => (
                <button
                  key={s.id}
                  className="slash-menu-item"
                  data-selected={i === slashCmd.selectedIdx}
                  role="option"
                  aria-selected={i === slashCmd.selectedIdx}
                  onMouseDown={(e) => { e.preventDefault(); insertFromSlash(s); }}
                >
                  <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--accent)", minWidth: 100 }}>{s.id}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{s.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Preview/Pages pane: shown in Edit, Review, Pages modes */}
        {editorMode !== "source" && (
        <div
          className="pane pane-preview"
          data-annotatable={posture === "review" && mode === "html"}
          onClick={onPreviewClick}
        >
          {/* Phase 5b: Review mode banner */}
          {editorMode === "review" && (
            <div className="review-mode-banner">
              🔍 Review mode — agent suggestions and comments. Click any note to jump to source.
            </div>
          )}
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
                onLoad={() => {
                  // Restore scroll position after re-render so the view
                  // doesn't jump to the top when the iframe reloads.
                  const win = frameRef.current?.contentWindow;
                  if (win && savedPreviewScroll.current > 0) {
                    win.scrollTo({ top: savedPreviewScroll.current, behavior: "instant" as ScrollBehavior });
                  }
                }}
              />
            ) : (
              <div className="empty">Rendering first preview…</div>
            )
          ) : previewUrl ? (
            <iframe className="preview-frame" src={previewUrl} title="PDF preview" style={{ flex: 1 }} />
          ) : (
            <div className="empty">
              {previewing ? "Rendering PDF…" : "Render the PDF to see paginated output."}
            </div>
          )}
          {previewUrl && previewing && (
            <div className="preview-rendering-note" aria-live="polite">
              Rendering PDF…
            </div>
          )}
          {errors.length > 0 && (
            <div className="preview-stale-note">
              Preview paused — fix {errors.length} error{errors.length > 1 ? "s" : ""} to resume.
            </div>
          )}
        </div>
        )}
      </div>

      {/* Phase 4a: Floating agent toolbar on text selection in preview */}
      {selectionToolbar.visible && editorMode === "edit" && (
        <div
          className="selection-toolbar"
          style={{
            position: "fixed",
            top: Math.max(8, selectionToolbar.top),
            left: selectionToolbar.left,
            transform: "translateX(-50%)",
            zIndex: 200,
          }}
        >
          <button
            className="selection-toolbar-btn"
            onClick={() => {
              const top = offsetForLine(1);
              setRewriteTarget({ kind: "range", start: 0, end: 0, label: selectionToolbar.selectedText.slice(0, 60), top });
              setSelectionToolbar((s) => ({ ...s, visible: false }));
            }}
            title="Rewrite selected text"
          >Rewrite</button>
          <button
            className="selection-toolbar-btn"
            onClick={() => {
              const top = offsetForLine(1);
              setRewriteTarget({ kind: "range", start: 0, end: 0, label: "Shorten: " + selectionToolbar.selectedText.slice(0, 40), top });
              setSelectionToolbar((s) => ({ ...s, visible: false }));
            }}
            title="Make it shorter"
          >Shorten</button>
          <button
            className="selection-toolbar-btn"
            onClick={() => {
              const top = offsetForLine(1);
              setRewriteTarget({ kind: "range", start: 0, end: 0, label: "Strengthen: " + selectionToolbar.selectedText.slice(0, 40), top });
              setSelectionToolbar((s) => ({ ...s, visible: false }));
            }}
            title="Make it stronger"
          >Strengthen</button>
          <button
            className="selection-toolbar-btn"
            onClick={() => setSelectionToolbar((s) => ({ ...s, visible: false }))}
            title="Dismiss"
          >×</button>
        </div>
      )}

      {/* Phase 4b: Command palette ⌘K */}
      {cmdPalette && (
        <div
          className="cmd-palette-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setCmdPalette(false); }}
        >
          <div className="cmd-palette">
            <div className="cmd-palette-search">
              <span className="cmd-palette-icon">⌘</span>
              <input
                className="cmd-palette-input"
                autoFocus
                placeholder="Type a command…"
                value={cmdQuery}
                onChange={(e) => { setCmdQuery(e.target.value); setCmdSelectedIdx(0); }}
                onKeyDown={(e) => {
                  const cmds = [
                    { label: "Export PDF", action: () => { setEditorMode("pages"); setCmdPalette(false); } },
                    { label: "Open Source view", action: () => { setEditorMode("source"); setCmdPalette(false); } },
                    { label: "Toggle Outline", action: () => { setShowOutline((v) => !v); setCmdPalette(false); } },
                    { label: "Insert block (palette)", action: () => { setShowPalette((v) => !v); setCmdPalette(false); } },
                    { label: "Edit mode", action: () => { setEditorMode("edit"); setCmdPalette(false); } },
                    { label: "Pages mode", action: () => { setEditorMode("pages"); setCmdPalette(false); } },
                  ];
                  const filtered = cmds.filter((c) => !cmdQuery || c.label.toLowerCase().includes(cmdQuery.toLowerCase()));
                  if (e.key === "Escape") { setCmdPalette(false); }
                  else if (e.key === "ArrowDown") { e.preventDefault(); setCmdSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setCmdSelectedIdx((i) => Math.max(0, i - 1)); }
                  else if (e.key === "Enter") { e.preventDefault(); filtered[cmdSelectedIdx]?.action(); }
                }}
              />
            </div>
            <div className="cmd-palette-list">
              {([
                { label: "Export PDF", action: () => { setEditorMode("pages"); setCmdPalette(false); } },
                { label: "Open Source view", action: () => { setEditorMode("source"); setCmdPalette(false); } },
                { label: "Toggle Outline", action: () => { setShowOutline((v) => !v); setCmdPalette(false); } },
                { label: "Insert block (palette)", action: () => { setShowPalette((v) => !v); setCmdPalette(false); } },
                { label: "Edit mode", action: () => { setEditorMode("edit"); setCmdPalette(false); } },
                { label: "Pages mode", action: () => { setEditorMode("pages"); setCmdPalette(false); } },
              ] as Array<{label:string;action:()=>void}>)
                .filter((c) => !cmdQuery || c.label.toLowerCase().includes(cmdQuery.toLowerCase()))
                .map((c, i) => (
                  <button
                    key={c.label}
                    className="cmd-palette-item"
                    data-selected={i === cmdSelectedIdx}
                    onClick={c.action}
                  >
                    {c.label}
                  </button>
                ))
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
