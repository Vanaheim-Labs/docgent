/**
 * docgent-lang.ts
 *
 * CodeMirror 6 language extension for Docgent Markdown.
 *
 * StreamLanguage maps token strings → Tag instances via the `tokenTable`
 * option. HighlightStyle + syntaxHighlighting maps those Tags → CSS on the
 * inline spans. A ViewPlugin with line decorations adds CSS classes to the
 * *line* elements so heading lines actually grow in height.
 */

import { StreamLanguage, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Tag } from "@lezer/highlight";
import { RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, Decoration, ViewPlugin, ViewUpdate } from "@codemirror/view";

// ─── Tags ─────────────────────────────────────────────────────────────────────

const dgHeading1  = Tag.define();
const dgHeading2  = Tag.define();
const dgHeading3  = Tag.define();
const dgHeadingN  = Tag.define();
const dgBold      = Tag.define();
const dgItalic    = Tag.define();
const dgCode      = Tag.define();
const dgPageFence = Tag.define();
const dgDirective = Tag.define();
const dgFmFence   = Tag.define();
const dgBlockPrim = Tag.define();

// ─── Token → Tag table ────────────────────────────────────────────────────────

const tokenTable: Record<string, Tag> = {
  heading1:   dgHeading1,
  heading2:   dgHeading2,
  heading3:   dgHeading3,
  headingN:   dgHeadingN,
  bold:       dgBold,
  italic:     dgItalic,
  inlineCode: dgCode,
  pageFence:  dgPageFence,
  directive:  dgDirective,
  fmFence:    dgFmFence,
  blockPrim:  dgBlockPrim,
};

// ─── StreamLanguage tokeniser ──────────────────────────────────────────────────

type DocgentState = {
  inFrontmatter: boolean;
  frontmatterDone: boolean;
  lineIndex: number;
};

const docgentStream = StreamLanguage.define<DocgentState>({
  name: "docgent",
  tokenTable,

  startState(): DocgentState {
    return { inFrontmatter: false, frontmatterDone: false, lineIndex: 0 };
  },

  token(stream, state) {
    if (stream.sol()) {
      state.lineIndex++;

      if (state.lineIndex === 1 && stream.match(/^---\s*$/)) {
        state.inFrontmatter = true;
        stream.skipToEnd();
        return "fmFence";
      }
      if (state.inFrontmatter && !state.frontmatterDone && stream.match(/^---\s*$/)) {
        state.inFrontmatter = false;
        state.frontmatterDone = true;
        stream.skipToEnd();
        return "fmFence";
      }
      if (state.inFrontmatter) {
        stream.skipToEnd();
        return null;
      }

      if (stream.match(/^---page\{/) || stream.match(/^---\/page---/)) {
        stream.skipToEnd();
        return "pageFence";
      }
      if (stream.match(/^:::\s/) || stream.match(/^:::$/)) {
        stream.skipToEnd();
        return "blockPrim";
      }
      if (stream.match(/^::[a-zA-Z][^\s{]*\s*\{/)) {
        stream.skipToEnd();
        return "directive";
      }

      if (stream.match(/^###### /)) { stream.skipToEnd(); return "headingN"; }
      if (stream.match(/^##### /))  { stream.skipToEnd(); return "headingN"; }
      if (stream.match(/^#### /))   { stream.skipToEnd(); return "headingN"; }
      if (stream.match(/^### /))    { stream.skipToEnd(); return "heading3"; }
      if (stream.match(/^## /))     { stream.skipToEnd(); return "heading2"; }
      if (stream.match(/^# /))      { stream.skipToEnd(); return "heading1"; }
    }

    if (stream.match(/\*\*[^*\n]+\*\*/)) return "bold";
    if (stream.match(/\*[^*\n]+\*/))     return "italic";
    if (stream.match(/`[^`\n]+`/))       return "inlineCode";

    stream.next();
    return null;
  },

  copyState(state): DocgentState { return { ...state }; },
  blankLine(state) { state.lineIndex++; },
});

// ─── Highlight style (inline spans) ───────────────────────────────────────────

const docgentStyle = HighlightStyle.define([
  // Headings: the span gets colour + weight. The line container gets font-size
  // from the ViewPlugin line decorations below.
  { tag: dgHeading1,  color: "#4338ca", fontWeight: "800" },
  { tag: dgHeading2,  color: "#4f46e5", fontWeight: "700" },
  { tag: dgHeading3,  color: "#6b5bd6", fontWeight: "650" },
  { tag: dgHeadingN,  color: "#8b7ee0", fontWeight: "600" },
  // Inline marks
  { tag: dgBold,      color: "#c2410c", fontWeight: "700" },
  { tag: dgItalic,    color: "#64748b", fontStyle: "italic" },
  { tag: dgCode,      color: "#c7254e", background: "#f0f4f8", borderRadius: "3px",
    padding: "0 2px", fontFamily: "var(--mono, monospace)", fontSize: "0.91em" },
  // Block / fence tokens
  { tag: dgPageFence, color: "#92400e", fontWeight: "600" },
  { tag: dgDirective, color: "#0e7490", fontWeight: "600" },
  { tag: dgFmFence,   color: "#94a3b8" },
  { tag: dgBlockPrim, color: "#92400e", fontWeight: "600" },
]);

// ─── Line decoration plugin ────────────────────────────────────────────────────
// Adds CSS classes to *line* elements so the container expands to match the
// heading font size. HighlightStyle only reaches inline <span>s; without this
// the heading lines stay at body height even though the text inside is bigger.
//
// Also adds background-tint classes to pageFence and blockPrim lines so they
// get a full-width amber slab (like Autype), not just coloured text.

const H1_RE   = /^# (?!#)/;
const H2_RE   = /^## (?!#)/;
const H3_RE   = /^### (?!#)/;
const PAGE_RE = /^(---page\{|---\/page---)/;
const PRIM_RE = /^:::/;

function buildLineDecorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  const h1Cls   = Decoration.line({ class: "dg-line-h1" });
  const h2Cls   = Decoration.line({ class: "dg-line-h2" });
  const h3Cls   = Decoration.line({ class: "dg-line-h3" });
  const pageCls = Decoration.line({ class: "dg-line-page" });
  const primCls = Decoration.line({ class: "dg-line-prim" });

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      if      (H1_RE.test(text))   builder.add(line.from, line.from, h1Cls);
      else if (H2_RE.test(text))   builder.add(line.from, line.from, h2Cls);
      else if (H3_RE.test(text))   builder.add(line.from, line.from, h3Cls);
      else if (PAGE_RE.test(text)) builder.add(line.from, line.from, pageCls);
      else if (PRIM_RE.test(text)) builder.add(line.from, line.from, primCls);
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const lineDecoPlugin = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view: EditorView) {
      this.decorations = buildLineDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildLineDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

// ─── Base theme ───────────────────────────────────────────────────────────────

const editorBaseTheme = EditorView.baseTheme({
  "&": {
    flex: "1",
    minHeight: "320px",
    fontFamily: "var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    fontSize: "13.5px",
    lineHeight: "1.7",
    color: "var(--ink, #12161c)",
    background: "var(--paper, #ffffff)",
    outline: "none",
  },
  ".cm-scroller": { overflow: "auto", flex: "1", fontFamily: "inherit" },
  ".cm-content": { padding: "18px 20px", minHeight: "100%", caretColor: "var(--ink, #12161c)" },
  ".cm-line": { padding: "0 0 2px" },
  ".cm-cursor": { borderLeftColor: "var(--ink, #12161c)" },
  ".cm-selectionBackground, ::selection": { background: "rgba(31, 75, 110, 0.15) !important" },
  "&.cm-focused .cm-selectionBackground": { background: "rgba(31, 75, 110, 0.2) !important" },
  ".cm-gutters": {
    background: "var(--paper-alt, #f6f8fa)",
    borderRight: "1px solid var(--rule, #e3e8ee)",
    color: "var(--ink-faint, #8a94a1)",
    fontFamily: "var(--mono)",
    fontSize: "11.5px",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 8px", minWidth: "32px", textAlign: "right" },

  // ── Line-level heading sizes ─────────────────────────────────────────────
  // font-size on the .cm-line makes the whole line — gutter, text, cursor —
  // scale together. line-height:1.3 tightens the heading so it doesn't gap
  // awkwardly when surrounded by body text.
  ".dg-line-h1": { fontSize: "1.5em",  lineHeight: "1.3", fontWeight: "800", paddingBottom: "4px" },
  ".dg-line-h2": { fontSize: "1.25em", lineHeight: "1.3", fontWeight: "700", paddingBottom: "3px" },
  ".dg-line-h3": { fontSize: "1.1em",  lineHeight: "1.3", fontWeight: "650", paddingBottom: "2px" },

  // ── Full-width tinted blocks ─────────────────────────────────────────────
  ".dg-line-page": {
    background: "rgba(251,191,36,0.2)",
    borderLeft: "3px solid #f59e0b",
    paddingLeft: "10px",
  },
  ".dg-line-prim": {
    background: "rgba(251,191,36,0.12)",
    borderLeft: "3px solid #fbbf24",
    paddingLeft: "10px",
  },
});

// ─── Public API ────────────────────────────────────────────────────────────────

export function docgentLanguage(): Extension[] {
  return [
    docgentStream,
    syntaxHighlighting(docgentStyle),
    lineDecoPlugin,
    editorBaseTheme,
  ];
}
