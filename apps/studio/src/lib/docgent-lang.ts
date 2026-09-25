/**
 * docgent-lang.ts
 *
 * CodeMirror 6 language extension for Docgent Markdown.
 *
 * StreamLanguage maps token strings → Tag instances via the `tokenTable`
 * option, then HighlightStyle + syntaxHighlighting maps those Tags to CSS.
 * This is the correct CM6 path — baseTheme .cm-tokenName does NOT work
 * with StreamLanguage (those class names are not emitted).
 */

import { StreamLanguage, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Tag } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// ─── Tag definitions ───────────────────────────────────────────────────────────
// Each tag is a distinct semantic class. We define our own rather than
// reusing the standard `tags` set so they don't accidentally inherit generic
// highlight styles from third-party themes.

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

// ─── Token name → Tag mapping ──────────────────────────────────────────────────
// StreamLanguage.define({ tokenTable }) maps the string returned by token()
// to a Tag. This is what replaces the broken .cm-tokenName approach.

const tokenTable: Record<string, Tag> = {
  heading1:  dgHeading1,
  heading2:  dgHeading2,
  heading3:  dgHeading3,
  headingN:  dgHeadingN,
  bold:      dgBold,
  italic:    dgItalic,
  inlineCode: dgCode,
  pageFence: dgPageFence,
  directive: dgDirective,
  fmFence:   dgFmFence,
  blockPrim: dgBlockPrim,
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

      // Frontmatter open delimiter (first line only)
      if (state.lineIndex === 1 && stream.match(/^---\s*$/)) {
        state.inFrontmatter = true;
        stream.skipToEnd();
        return "fmFence";
      }
      // Frontmatter close delimiter
      if (state.inFrontmatter && !state.frontmatterDone && stream.match(/^---\s*$/)) {
        state.inFrontmatter = false;
        state.frontmatterDone = true;
        stream.skipToEnd();
        return "fmFence";
      }
      // Inside frontmatter — no token (plain colour)
      if (state.inFrontmatter) {
        stream.skipToEnd();
        return null;
      }

      // Page fence: ---page{ ... or ---/page---
      if (stream.match(/^---page\{/) || stream.match(/^---\/page---/)) {
        stream.skipToEnd();
        return "pageFence";
      }

      // Block primitives: ::: pagebreak, ::: toc, ::: {.something}
      if (stream.match(/^:::\s/)) {
        stream.skipToEnd();
        return "blockPrim";
      }
      // Self-closing ::: on its own line (closing fence)
      if (stream.match(/^:::$/)) {
        stream.skipToEnd();
        return "blockPrim";
      }

      // Directive: ::something{
      if (stream.match(/^::[a-zA-Z][^\s{]*\s*\{/)) {
        stream.skipToEnd();
        return "directive";
      }

      // Headings (order matters: check ## before #)
      if (stream.match(/^###### /)) { stream.skipToEnd(); return "headingN"; }
      if (stream.match(/^##### /))  { stream.skipToEnd(); return "headingN"; }
      if (stream.match(/^#### /))   { stream.skipToEnd(); return "headingN"; }
      if (stream.match(/^### /))    { stream.skipToEnd(); return "heading3"; }
      if (stream.match(/^## /))     { stream.skipToEnd(); return "heading2"; }
      if (stream.match(/^# /))      { stream.skipToEnd(); return "heading1"; }
    }

    // ── Inline tokens ──────────────────────────────────────────────────────────
    // Bold must be checked before italic to avoid ** being swallowed by *
    if (stream.match(/\*\*[^*\n]+\*\*/)) return "bold";
    if (stream.match(/\*[^*\n]+\*/))     return "italic";
    if (stream.match(/`[^`\n]+`/))       return "inlineCode";

    // Advance one char so the tokeniser never stalls
    stream.next();
    return null;
  },

  copyState(state): DocgentState {
    return { ...state };
  },

  blankLine(state) {
    state.lineIndex++;
  },
});

// ─── Highlight style ───────────────────────────────────────────────────────────
// Maps our custom Tags → CSS. This is what actually produces colours in the
// editor. syntaxHighlighting(style) wraps it as a CM6 Extension.

const docgentStyle = HighlightStyle.define([
  { tag: dgHeading1,  color: "#6b5bd6", fontWeight: "700", fontSize: "1.12em" },
  { tag: dgHeading2,  color: "#6b5bd6", fontWeight: "650", fontSize: "1.06em" },
  { tag: dgHeading3,  color: "#6b5bd6", fontWeight: "600" },
  { tag: dgHeadingN,  color: "#8b7ee0", fontWeight: "600" },
  { tag: dgBold,      color: "#1f4b6e", fontWeight: "700" },
  { tag: dgItalic,    color: "#454e5a", fontStyle: "italic" },
  { tag: dgCode,      color: "#c7254e", background: "#f0f4f8", borderRadius: "3px", padding: "0 2px", fontFamily: "var(--mono, monospace)", fontSize: "0.91em" },
  { tag: dgPageFence, color: "#92400e", background: "rgba(251,191,36,0.18)", fontWeight: "600" },
  { tag: dgDirective, color: "#0e7490", fontWeight: "600" },
  { tag: dgFmFence,   color: "#8a94a1" },
  { tag: dgBlockPrim, color: "#92400e", background: "rgba(251,191,36,0.12)", fontWeight: "600" },
]);

// ─── Editor base theme ─────────────────────────────────────────────────────────

const editorBaseTheme = EditorView.baseTheme({
  "&": {
    flex: "1",
    minHeight: "320px",
    fontFamily: "var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    fontSize: "13px",
    lineHeight: "1.65",
    color: "var(--ink, #12161c)",
    background: "var(--paper, #ffffff)",
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
    flex: "1",
    fontFamily: "inherit",
  },
  ".cm-content": {
    padding: "18px 20px",
    minHeight: "100%",
    caretColor: "var(--ink, #12161c)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--ink, #12161c)" },
  ".cm-selectionBackground, ::selection": {
    background: "rgba(31, 75, 110, 0.15) !important",
  },
  ".cm-gutters": {
    background: "var(--paper-alt, #f6f8fa)",
    borderRight: "1px solid var(--rule, #e3e8ee)",
    color: "var(--ink-faint, #8a94a1)",
    fontFamily: "var(--mono)",
    fontSize: "11.5px",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 10px 0 8px",
    minWidth: "32px",
    textAlign: "right",
  },
  "&.cm-focused .cm-selectionBackground": {
    background: "rgba(31, 75, 110, 0.2) !important",
  },
});

// ─── Public API ────────────────────────────────────────────────────────────────

export function docgentLanguage(): Extension[] {
  return [
    docgentStream,
    syntaxHighlighting(docgentStyle),
    editorBaseTheme,
  ];
}
