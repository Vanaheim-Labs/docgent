"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Vocabulary } from "@/lib/vocabulary";
import { validateMarkdown, type Diagnostic } from "@/lib/validate-client";
import { RewriteBar, type RewriteProposal } from "@/components/RewriteBar";
import { ProposalReview } from "@/components/ProposalReview";

// CodeMirror 6
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, undo, redo } from "@codemirror/commands";
import { docgentLanguage } from "@/lib/docgent-lang";

// Lucide icons
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Highlighter,
  Link2,
  List,
  ListOrdered,
  Table,
  Image,
  Code2,
  Minus,
  Undo2,
  Redo2,
  // Primitive block icons
  Columns,
  MessageSquare,
  Quote,
  BarChart2,
  SplitSquareVertical,
  FileText,
  Calendar,
  PenLine,
  Hash,
} from "lucide-react";

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

type Posture = "edit" | "review";

type Heading = { line: number; level: number; text: string };

type Fold = { startLine: number; endLine: number };

// Mapping from block id → lucide icon component
const BLOCK_ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  pagebreak:     SplitSquareVertical,
  toc:           List,
  columnsLayout: Columns,
  callout:       MessageSquare,
  pullquote:     Quote,
  keyfigure:     BarChart2,
  chart:         BarChart2,
  date:          Calendar,
  signature:     PenLine,
  image:         Image,
};

export function Editor({ brand, slug, initialContent, initialSha, vocabulary }: Props) {
  const [content, setContent] = useState(initialContent);
  const [baseSha, setBaseSha] = useState(initialSha);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [summary, setSummary] = useState("");
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
  const [rewriteTarget, setRewriteTarget] = useState<
    | { kind: "section"; heading: string; label: string; top: number }
    | { kind: "range"; start: number; end: number; label: string; top: number }
    | null
  >(null);
  const [proposal, setProposal] = useState<RewriteProposal | null>(null);
  const [acceptedNote, setAcceptedNote] = useState<string | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  // CM6 editor lives here instead of the old textarea
  const cmContainerRef = useRef<HTMLDivElement>(null);
  const cmViewRef = useRef<EditorView | null>(null);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPreviewed = useRef<string>("");
  const lastPdfRendered = useRef<string>("");
  const objectUrl = useRef<string | null>(null);
  const syncLock = useRef<0 | 1 | 2>(0);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Derived state ─────────────────────────────────────────────────────────
  const dirty = content !== initialContent || save.kind === "error" || save.kind === "stale";

  const diagnostics = useMemo(
    () => validateMarkdown(content, vocabulary),
    [content, vocabulary]
  );
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  // ── Fold / display content ────────────────────────────────────────────────

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

  // ── CodeMirror mount / sync ───────────────────────────────────────────────

  // Mount once
  useEffect(() => {
    if (!cmContainerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: displayContent,
        extensions: [
          history(),
          lineNumbers(),
          keymap.of([
            ...defaultKeymap,
            {
              key: "Mod-s",
              run: () => {
                // Trigger save — we reach into the state via closure below
                doSaveRef.current();
                return true;
              },
            },
            {
              key: "Mod-b",
              run: (v) => { toggleInlineRef.current("**", "bold text"); return true; },
            },
            {
              key: "Mod-i",
              run: (v) => { toggleInlineRef.current("*", "italic text"); return true; },
            },
            {
              key: "Mod-e",
              run: (v) => { toggleInlineRef.current("`", "code"); return true; },
            },
            {
              key: "Mod-k",
              run: (v) => { insertLinkRef.current(); return true; },
            },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const newText = update.state.doc.toString();
              if (!isFoldedRef.current) {
                setContent(newText);
                setSave((s) => (s.kind === "saved" ? { kind: "idle" } : s));
              }
            }
          }),
          EditorState.readOnly.of(false),
          ...docgentLanguage(),
        ],
      }),
      parent: cmContainerRef.current,
    });

    cmViewRef.current = view;
    return () => {
      view.destroy();
      cmViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync displayContent → CM6 when it changes externally (fold/unfold, accept proposal)
  const lastSyncedContent = useRef<string>(displayContent);
  useEffect(() => {
    const view = cmViewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === displayContent) return;
    lastSyncedContent.current = displayContent;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: displayContent },
    });
  }, [displayContent]);

  // Sync readOnly when fold state changes
  useEffect(() => {
    const view = cmViewRef.current;
    if (!view) return;
    // Reconfigure readOnly by updating the extension
    view.dispatch({
      effects: view.state.facet(EditorState.readOnly) === isFolded
        ? []
        : [],
    });
    // Add/remove a CSS class on the container for cursor styling
    if (cmContainerRef.current) {
      cmContainerRef.current.classList.toggle("cm-folded", isFolded);
    }
  }, [isFolded]);

  // Mutable refs to avoid stale closures in keymap
  const isFoldedRef = useRef(isFolded);
  isFoldedRef.current = isFolded;

  // ── Preview ───────────────────────────────────────────────────────────────

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

  useEffect(() => {
    runHtmlPreview(initialContent);
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode !== "pdf") return;
    if (errors.length > 0) return;
    if (content === lastPdfRendered.current && previewUrl) return;
    runPdfPreview(content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ── Save ──────────────────────────────────────────────────────────────────

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
          message: summary.trim()
            ? `docs(${brand}/${slug}): ${summary.trim()}`
            : undefined,
        }),
      });
      const data = await res.json();
      if (res.status === 409) { setSave({ kind: "stale", message: data.message || "This document changed since you opened it." }); return; }
      if (res.status === 422) {
        const first = (data.diagnostics || [])[0];
        setSave({ kind: "error", message: first ? `Line ${first.line}: ${first.message}` : "Validation failed." });
        return;
      }
      if (!res.ok) { setSave({ kind: "error", message: data.error || `Save failed (${res.status})` }); return; }
      setBaseSha(data.sha);
      setSummary("");
      setSave({ kind: "saved", sha: data.sha, commit: data.commit });
    } catch (e) {
      setSave({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [brand, slug, content, baseSha, errors.length, summary]);

  // Stable ref for keymap closure
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); doSave(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setShowPalette((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ── Scroll sync ───────────────────────────────────────────────────────────

  const releaseSync = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => { syncLock.current = 0; syncTimer.current = null; }, 80);
  }, []);

  const lockSync = useCallback((who: 1 | 2) => {
    syncLock.current = who;
    if (syncTimer.current) { clearTimeout(syncTimer.current); syncTimer.current = null; }
  }, []);

  const anchors = useCallback((): { line: number; el: HTMLElement }[] => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return [];
    return Array.from(doc.querySelectorAll<HTMLElement>("[data-source-line]"))
      .map((el) => ({ line: Number(el.dataset.sourceLine), el }))
      .filter((a) => Number.isFinite(a.line))
      .sort((a, b) => a.line - b.line);
  }, []);

  const docTop = useCallback((el: HTMLElement, win: Window): number => {
    const r = el.getBoundingClientRect();
    return r.top + win.scrollY;
  }, []);

  // Get the CM6 scroll DOM element
  const getScrollEl = useCallback((): HTMLElement | null => {
    return cmViewRef.current?.scrollDOM ?? null;
  }, []);

  // Line → pixel offset inside CM6 editor
  const offsetForCmLine = useCallback((lineNum: number): number => {
    const view = cmViewRef.current;
    if (!view) return 0;
    try {
      const doc = view.state.doc;
      const clampedLine = Math.max(1, Math.min(lineNum, doc.lines));
      const lineObj = doc.line(clampedLine);
      const coords = view.lineBlockAt(lineObj.from);
      return coords?.top ?? 0;
    } catch {
      return 0;
    }
  }, []);

  // Pixel offset → fractional line number in CM6
  const cmTopSourceLine = useCallback((): number => {
    const view = cmViewRef.current;
    if (!view) return 1;
    const scrollTop = view.scrollDOM.scrollTop;
    const block = view.lineBlockAtHeight(scrollTop);
    if (!block) return 1;
    try {
      const line = view.state.doc.lineAt(block.from);
      return line.number;
    } catch {
      return 1;
    }
  }, []);

  const syncEditorToPreview = useCallback(() => {
    if (mode !== "html") return;
    if (syncLock.current === 2) { releaseSync(); return; }
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    lockSync(1);
    const list = anchors();
    if (list.length === 0) { releaseSync(); return; }
    const line = cmTopSourceLine();
    let lo = list[0]; let hi = list[list.length - 1];
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
    if (Math.abs(win.scrollY - next) < 2) { releaseSync(); return; }
    win.scrollTo({ top: next, behavior: "auto" });
    releaseSync();
  }, [mode, anchors, cmTopSourceLine, docTop, lockSync, releaseSync]);

  const syncPreviewToEditor = useCallback(() => {
    if (mode !== "html") return;
    if (syncLock.current === 1) { releaseSync(); return; }
    const scrollEl = getScrollEl();
    const win = frameRef.current?.contentWindow;
    if (!scrollEl || !win) return;
    lockSync(2);
    const list = anchors();
    if (list.length === 0) { releaseSync(); return; }
    const y = win.scrollY + 8;
    let lo = list[0]; let hi = list[list.length - 1];
    for (let i = 0; i < list.length; i++) {
      const top = docTop(list[i].el, win);
      if (top <= y) lo = list[i];
      if (top >= y) { hi = list[i]; break; }
    }
    const loTop = docTop(lo.el, win);
    const hiTop = docTop(hi.el, win);
    const pxSpan = hiTop - loTop;
    const frac = pxSpan > 0 ? (y - loTop) / pxSpan : 0;
    const line = lo.line + (hi.line - lo.line) * Math.min(1, Math.max(0, frac));
    const next = Math.max(0, offsetForCmLine(Math.round(line)));
    if (Math.abs(scrollEl.scrollTop - next) < 2) { releaseSync(); return; }
    scrollEl.scrollTop = next;
    releaseSync();
  }, [mode, anchors, docTop, offsetForCmLine, getScrollEl, lockSync, releaseSync]);

  // Attach CM6 scroll listener
  useEffect(() => {
    const view = cmViewRef.current;
    if (!view) return;
    const handler = () => syncEditorToPreview();
    view.scrollDOM.addEventListener("scroll", handler, { passive: true });
    return () => view.scrollDOM.removeEventListener("scroll", handler);
  }, [syncEditorToPreview]);

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

  // ── Outline / jump ────────────────────────────────────────────────────────

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
      const view = cmViewRef.current;
      if (!view) return;
      try {
        const doc = view.state.doc;
        const lineObj = doc.line(Math.max(1, Math.min(line, doc.lines)));
        view.dispatch({
          selection: { anchor: lineObj.from },
          scrollIntoView: true,
        });
        view.focus();
        syncEditorToPreview();
      } catch { /* ignore */ }
    });
  }, [headings, sectionEnd, syncEditorToPreview]);

  // ── Text editing helpers ──────────────────────────────────────────────────

  // Core edit primitive: replaces a range in the buffer and sets the CM6
  // selection. All formatting flows through here.
  const applyEdit = useCallback(
    (next: string, selStart: number, selEnd: number) => {
      setContent(next);
      setSave((s) => (s.kind === "saved" ? { kind: "idle" } : s));
      // Push the change to CM6 and restore selection
      const view = cmViewRef.current;
      if (view) {
        const current = view.state.doc.toString();
        view.dispatch({
          changes: { from: 0, to: current.length, insert: next },
          selection: { anchor: selStart, head: selEnd },
        });
        view.focus();
      }
    },
    []
  );

  // Helper: get the current selection from CM6 (or fallback 0,0)
  const getSelection = useCallback((): { start: number; end: number } => {
    const view = cmViewRef.current;
    if (!view) return { start: 0, end: 0 };
    const sel = view.state.selection.main;
    return { start: sel.from, end: sel.to };
  }, []);

  const getDoc = useCallback((): string => {
    const view = cmViewRef.current;
    return view ? view.state.doc.toString() : content;
  }, [content]);

  const toggleInline = useCallback(
    (mark: string, placeholder: string) => {
      if (isFolded) return;
      const { start, end } = getSelection();
      const doc = getDoc();
      const selected = doc.slice(start, end);
      const len = mark.length;

      if (selected.length >= len * 2 && selected.startsWith(mark) && selected.endsWith(mark)) {
        const inner = selected.slice(len, -len);
        applyEdit(doc.slice(0, start) + inner + doc.slice(end), start, start + inner.length);
        return;
      }
      const before = doc.slice(Math.max(0, start - len), start);
      const after = doc.slice(end, end + len);
      if (before === mark && after === mark) {
        applyEdit(doc.slice(0, start - len) + selected + doc.slice(end + len), start - len, start - len + selected.length);
        return;
      }
      const body = selected || placeholder;
      const text = mark + body + mark;
      applyEdit(doc.slice(0, start) + text + doc.slice(end), start + len, start + len + body.length);
    },
    [isFolded, getSelection, getDoc, applyEdit]
  );

  // Mutable ref so CM6 keymap can always call the latest version
  const toggleInlineRef = useRef(toggleInline);
  toggleInlineRef.current = toggleInline;

  const transformLines = useCallback(
    (fn: (lines: string[]) => string[]) => {
      if (isFolded) return;
      const { start, end } = getSelection();
      const doc = getDoc();
      const from = doc.lastIndexOf("\n", start - 1) + 1;
      let to = doc.indexOf("\n", end);
      if (to === -1) to = doc.length;
      const effectiveTo = end > from && doc[end - 1] === "\n" && end - 1 >= from ? end - 1 : to;
      const block = doc.slice(from, effectiveTo);
      const next = fn(block.split("\n")).join("\n");
      applyEdit(doc.slice(0, from) + next + doc.slice(effectiveTo), from, from + next.length);
    },
    [isFolded, getSelection, getDoc, applyEdit]
  );

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

  const applyQuoteBlock = useCallback(() => {
    transformLines((lines) => {
      const allQ = lines.every((l) => l.trim() === "" || /^\s*>\s?/.test(l));
      return lines.map((l) => {
        if (l.trim() === "") return l;
        return allQ ? l.replace(/^(\s*)>\s?/, "$1") : `> ${l}`;
      });
    });
  }, [transformLines]);

  const insertLink = useCallback(() => {
    if (isFolded) return;
    const { start, end } = getSelection();
    const doc = getDoc();
    const selected = doc.slice(start, end);
    const label = selected || "link text";
    const text = `[${label}](url)`;
    const urlAt = start + label.length + 3;
    applyEdit(doc.slice(0, start) + text + doc.slice(end), urlAt, urlAt + 3);
  }, [isFolded, getSelection, getDoc, applyEdit]);

  const insertLinkRef = useRef(insertLink);
  insertLinkRef.current = insertLink;

  const insertRule = useCallback(() => {
    if (isFolded) return;
    const { start } = getSelection();
    const doc = getDoc();
    const atLineStart = start === 0 || doc[start - 1] === "\n";
    const text = `${atLineStart ? "" : "\n"}\n---\n\n`;
    const pos = start + text.length;
    applyEdit(doc.slice(0, start) + text + doc.slice(start), pos, pos);
  }, [isFolded, getSelection, getDoc, applyEdit]);

  const insertCodeBlock = useCallback(() => {
    if (isFolded) return;
    const { start, end } = getSelection();
    const doc = getDoc();
    const selected = doc.slice(start, end);
    const body = selected || "code";
    const atLineStart = start === 0 || doc[start - 1] === "\n";
    const lead = atLineStart ? "" : "\n";
    const text = `${lead}\`\`\`\n${body}\n\`\`\`\n`;
    const bodyAt = start + lead.length + 4;
    applyEdit(doc.slice(0, start) + text + doc.slice(end), bodyAt, bodyAt + body.length);
  }, [isFolded, getSelection, getDoc, applyEdit]);

  const insertTable = useCallback(() => {
    if (isFolded) return;
    const { start } = getSelection();
    const doc = getDoc();
    const atLineStart = start === 0 || doc[start - 1] === "\n";
    const lead = atLineStart ? "" : "\n";
    const tbl = `${lead}| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n`;
    applyEdit(doc.slice(0, start) + tbl + doc.slice(start), start + lead.length + 2, start + lead.length + 10);
  }, [isFolded, getSelection, getDoc, applyEdit]);

  const insertImage = useCallback(() => {
    if (isFolded) return;
    const { start, end } = getSelection();
    const doc = getDoc();
    const selected = doc.slice(start, end);
    const alt = selected || "alt text";
    const text = `![${alt}](url)`;
    const urlAt = start + alt.length + 4;
    applyEdit(doc.slice(0, start) + text + doc.slice(end), urlAt, urlAt + 3);
  }, [isFolded, getSelection, getDoc, applyEdit]);

  const insertHighlight = useCallback(() => {
    toggleInline("==", "highlighted text");
  }, [toggleInline]);

  const insertUnderline = useCallback(() => {
    if (isFolded) return;
    const { start, end } = getSelection();
    const doc = getDoc();
    const selected = doc.slice(start, end);
    const body = selected || "underlined text";
    const text = `<u>${body}</u>`;
    applyEdit(doc.slice(0, start) + text + doc.slice(end), start + 3, start + 3 + body.length);
  }, [isFolded, getSelection, getDoc, applyEdit, toggleInline]);

  const doUndo = useCallback(() => {
    const view = cmViewRef.current;
    if (view) undo(view);
  }, []);

  const doRedo = useCallback(() => {
    const view = cmViewRef.current;
    if (view) redo(view);
  }, []);

  // ── Directed rewrite ──────────────────────────────────────────────────────

  const offsetForLine = useCallback((line: number): number => {
    return offsetForCmLine(line);
  }, [offsetForCmLine]);

  const openSelectionRewrite = useCallback(() => {
    if (isFolded) return;
    const { start, end } = getSelection();
    if (end <= start) return;
    const doc = getDoc();
    const selected = doc.slice(start, end);
    const label = selected.trim().length > 60 ? selected.trim().slice(0, 57) + "…" : selected.trim();
    const scrollTop = cmViewRef.current?.scrollDOM.scrollTop ?? 0;
    const top = Math.max(0, offsetForLine(doc.slice(0, start).split("\n").length) - scrollTop);
    setProposal(null); setAcceptedNote(null);
    setRewriteTarget({ kind: "range", start, end, label: label || "selection", top });
  }, [isFolded, getSelection, getDoc, offsetForLine]);

  const openSectionRewrite = useCallback(
    (h: Heading) => {
      const scrollTop = cmViewRef.current?.scrollDOM.scrollTop ?? 0;
      const top = Math.max(0, offsetForLine(h.line) - scrollTop);
      setProposal(null); setAcceptedNote(null);
      setRewriteTarget({ kind: "section", heading: h.text, label: h.text, top });
    },
    [offsetForLine]
  );

  const closeRewrite = useCallback(() => { setRewriteTarget(null); setProposal(null); }, []);

  const getScope = useCallback(():
    | { kind: "section"; heading: string }
    | { kind: "range"; start: number; end: number } => {
    if (!rewriteTarget) return { kind: "range", start: 0, end: 0 };
    if (rewriteTarget.kind === "section") return { kind: "section", heading: rewriteTarget.heading };
    return { kind: "range", start: rewriteTarget.start, end: rewriteTarget.end };
  }, [rewriteTarget]);

  const acceptProposal = useCallback(
    (finalContent: string, accepted: RewriteProposal) => {
      applyEdit(finalContent, accepted.span.start, accepted.span.start + accepted.after.length);
      setBaseSha((prev) => prev);
      setAcceptedNote(`Accepted — ${accepted.model.label}: "${accepted.instruction}"`);
      setProposal(null);
      setRewriteTarget(null);
    },
    [applyEdit]
  );

  // ── Snippet insertion ─────────────────────────────────────────────────────

  const insertSnippet = useCallback((snippet: string) => {
    const { start, end } = getSelection();
    const doc = getDoc();
    const selected = doc.slice(start, end);
    const body = selected || "Content goes here.";
    const text = snippet.replace("$BODY$", body);
    const next = doc.slice(0, start) + text + doc.slice(end);
    const cursor = start + text.indexOf(body);
    applyEdit(next, cursor, cursor + body.length);
    setShowPalette(false);
  }, [getSelection, getDoc, applyEdit]);

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

  // ── Derived stats ─────────────────────────────────────────────────────────

  const lineCount = content.split("\n").length;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="editor">
      {/* ── Top toolbar ── */}
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
            <button className="mode-btn" data-active={posture === "edit"} onClick={() => setPosture("edit")} title="Authoring — source takes the space">Edit</button>
            <button className="mode-btn" data-active={posture === "review"} onClick={() => setPosture("review")} title="Judgement — read it as the reader will">Review</button>
          </div>
          <span className="editor-stat">{lineCount} lines · {wordCount} words</span>
          {isFolded && <span className="diag-pill" data-severity="warning" title="Unfold to edit">folded — read only</span>}
        </div>

        <div className="editor-toolbar-right">
          <div className="mode-toggle" role="group" aria-label="Preview mode">
            <button className="mode-btn" data-active={mode === "html"} onClick={() => setMode("html")} title="Fast preview with synchronised scrolling">Preview</button>
            <button className="mode-btn" data-active={mode === "pdf"} onClick={() => setMode("pdf")} title="Paginated PDF — exact print fidelity">PDF{pdfStale && mode === "pdf" ? " •" : ""}</button>
          </div>
          {mode === "pdf" && (
            <button className="btn btn-secondary" onClick={() => runPdfPreview(content)} disabled={previewing || errors.length > 0}>
              {previewing ? "Rendering…" : pdfStale ? "Re-render PDF" : "Render PDF"}
            </button>
          )}
          {previewing && <span className="editor-stat">rendering…</span>}
          {errors.length > 0 && <span className="diag-pill" data-severity="error">{errors.length} error{errors.length > 1 ? "s" : ""}</span>}
          {errors.length === 0 && warnings.length > 0 && <span className="diag-pill" data-severity="warning">{warnings.length} warning{warnings.length > 1 ? "s" : ""}</span>}
          {errors.length === 0 && warnings.length === 0 && <span className="diag-pill" data-severity="ok">valid</span>}
          {dirty && (
            <input
              className="commit-summary"
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What changed? (optional)"
              aria-label="Describe this revision"
              maxLength={72}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void doSave(); } }}
            />
          )}
          <button className="btn" onClick={doSave} disabled={save.kind === "saving" || errors.length > 0 || !dirty}>
            {save.kind === "saving" ? "Saving…" : "Save"} <kbd>⌘S</kbd>
          </button>
        </div>
      </div>

      {/* ── Rich format bar: Row 1 (inline / block formatting) ── */}
      <div className="format-bar format-bar-row1" role="toolbar" aria-label="Markdown formatting">
        {/* Paragraph / heading dropdown */}
        <div className="format-group">
          <select
            className="heading-select"
            disabled={isFolded}
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === "p") { transformLines((lines) => lines.map((l) => l.replace(/^#{1,6}\s+/, ""))); }
              else if (v) { applyHeading(parseInt(v, 10)); }
              e.target.value = "";
            }}
            title="Paragraph style"
            aria-label="Paragraph style"
          >
            <option value="" disabled>Paragraph</option>
            <option value="p">Paragraph</option>
            <option value="1">Heading 1</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
            <option value="4">Heading 4</option>
          </select>
        </div>

        <div className="format-divider" />

        <div className="format-group">
          <button className="format-btn" onClick={() => toggleInline("**", "bold text")} disabled={isFolded} title="Bold — ⌘B" aria-label="Bold">
            <Bold size={14} strokeWidth={2.5} />
          </button>
          <button className="format-btn" onClick={() => toggleInline("*", "italic text")} disabled={isFolded} title="Italic — ⌘I" aria-label="Italic">
            <Italic size={14} strokeWidth={2} />
          </button>
          <button className="format-btn" onClick={insertUnderline} disabled={isFolded} title="Underline" aria-label="Underline">
            <Underline size={14} strokeWidth={2} />
          </button>
          <button className="format-btn" onClick={() => toggleInline("~~", "struck text")} disabled={isFolded} title="Strikethrough" aria-label="Strikethrough">
            <Strikethrough size={14} strokeWidth={2} />
          </button>
          <button className="format-btn" onClick={insertHighlight} disabled={isFolded} title="Highlight (==text==)" aria-label="Highlight">
            <Highlighter size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="format-divider" />

        <div className="format-group">
          <button className="format-btn" onClick={insertLink} disabled={isFolded} title="Link — ⌘K" aria-label="Insert link">
            <Link2 size={14} strokeWidth={2} />
          </button>
          <button className="format-btn" onClick={applyBullets} disabled={isFolded} title="Bulleted list" aria-label="Bulleted list">
            <List size={14} strokeWidth={2} />
          </button>
          <button className="format-btn" onClick={applyNumbered} disabled={isFolded} title="Numbered list" aria-label="Numbered list">
            <ListOrdered size={14} strokeWidth={2} />
          </button>
          <button className="format-btn" onClick={insertTable} disabled={isFolded} title="Insert table" aria-label="Insert table">
            <Table size={14} strokeWidth={2} />
          </button>
          <button className="format-btn" onClick={insertImage} disabled={isFolded} title="Insert image" aria-label="Insert image">
            <Image size={14} strokeWidth={2} />
          </button>
          <button className="format-btn" onClick={insertCodeBlock} disabled={isFolded} title="Code block" aria-label="Code block">
            <Code2 size={14} strokeWidth={2} />
          </button>
          <button className="format-btn" onClick={insertRule} disabled={isFolded} title="Horizontal rule" aria-label="Horizontal rule">
            <Minus size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="format-divider" />

        <div className="format-group">
          <button className="format-btn" onClick={doUndo} disabled={isFolded} title="Undo" aria-label="Undo">
            <Undo2 size={14} strokeWidth={2} />
          </button>
          <button className="format-btn" onClick={doRedo} disabled={isFolded} title="Redo" aria-label="Redo">
            <Redo2 size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="format-divider" />

        {/* Rewrite */}
        <div className="format-group">
          <button className="format-btn format-btn-wide" onClick={openSelectionRewrite} disabled={isFolded} title="Select text first, then direct a rewrite" aria-label="Rewrite selection">
            ✨ Rewrite
          </button>
        </div>

        {isFolded && <span className="format-note">unfold a section to edit</span>}
      </div>

      {/* ── Rich format bar: Row 2 (vocabulary / primitive blocks) ── */}
      <div className="format-bar format-bar-row2" role="toolbar" aria-label="Docgent vocabulary blocks">
        <span className="format-bar-label">Blocks</span>
        {snippets.map((s) => {
          const Icon = BLOCK_ICONS[s.id];
          return (
            <button
              key={s.id}
              className={`format-btn format-btn-prim${s.id === "pagebreak" ? " format-btn-prim-accent" : ""}`}
              onClick={() => insertSnippet(s.snippet)}
              disabled={isFolded}
              title={s.description || s.id}
              aria-label={s.description || s.id}
            >
              {Icon ? <Icon size={14} strokeWidth={2} /> : null}
              <span className="format-btn-prim-label">{s.id}</span>
            </button>
          );
        })}
      </div>

      {/* ── Block palette (⌘/) ── */}
      {showPalette && (
        <div className="palette">
          <div className="palette-head">Vocabulary — the closed set of blocks you may use</div>
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

      {/* ── Banners ── */}
      {save.kind === "stale" && (
        <div className="banner" data-kind="stale">
          <strong>This document changed while you were editing.</strong>
          <div>{save.message}</div>
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-secondary" onClick={() => window.location.reload()}>Reload and reapply</button>
          </div>
        </div>
      )}
      {save.kind === "error" && <div className="banner" data-kind="error">{save.message}</div>}
      {save.kind === "saved" && <div className="banner" data-kind="ok">Saved{save.commit?.sha ? ` as ${save.commit.sha.slice(0, 7)}` : ""}.</div>}
      {acceptedNote && <div className="banner" data-kind="ok">{acceptedNote} — committed. Save is not needed for this change.</div>}

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

      {/* ── Two-pane layout ── */}
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
                      <button className="outline-fold" onClick={() => toggleFold(h.line)} disabled={!foldable} aria-label={isOpen ? "Fold section" : "Unfold section"} title={foldable ? (isOpen ? "Fold section" : "Unfold section") : "Nothing to fold"}>
                        {foldable ? (isOpen ? "▾" : "▸") : "·"}
                      </button>
                      <button className="outline-link" onClick={() => jumpToLine(h.line)} title={`${h.text} — line ${h.line}`}>{h.text}</button>
                      <button className="outline-direct" onClick={() => openSectionRewrite(h)} title={`Direct a rewrite of "${h.text}"`} aria-label={`Direct a rewrite of ${h.text}`}>✨</button>
                    </div>
                  );
                })}
              </div>
            </nav>
          )}

          {/* CodeMirror 6 host */}
          <div
            ref={cmContainerRef}
            className={`cm-host${isFolded ? " cm-host-readonly" : ""}`}
            aria-label="Document source editor"
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
              <iframe ref={frameRef} className="preview-frame" srcDoc={previewHtml} title="Live preview" sandbox="allow-same-origin" />
            ) : (
              <div className="empty">Rendering first preview…</div>
            )
          ) : previewUrl ? (
            <iframe className="preview-frame" src={previewUrl} title="PDF preview" />
          ) : (
            <div className="empty">{previewing ? "Rendering PDF…" : "Render the PDF to see paginated output."}</div>
          )}
          {previewUrl && previewing && <div className="preview-rendering-note" aria-live="polite">Rendering PDF…</div>}
          {errors.length > 0 && <div className="preview-stale-note">Preview paused — fix {errors.length} error{errors.length > 1 ? "s" : ""} to resume.</div>}
        </div>
      </div>
    </div>
  );
}
