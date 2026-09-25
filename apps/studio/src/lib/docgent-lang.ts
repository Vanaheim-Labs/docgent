/**
 * docgent-lang.ts
 *
 * CodeMirror 6 language extension for Docgent Markdown.
 * Uses StreamLanguage (no Lezer .grammar compilation) so it ships as plain TS.
 *
 * Token names used here are mapped to CSS classes via HighlightStyle below.
 * The classes are prefixed "dg-" so they cannot collide with CM6 defaults.
 */

import { StreamLanguage, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { Tag, styleTags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// ─── Custom tag set ────────────────────────────────────────────────────────────

const dgTags = {
  heading1:    Tag.define(),
  heading2:    Tag.define(),
  heading3:    Tag.define(),
  headingN:    Tag.define(),   // h4–h6
  bold:        Tag.define(),
  italic:      Tag.define(),
  inlineCode:  Tag.define(),
  pageFence:   Tag.define(),
  directive:   Tag.define(),
  fmFence:     Tag.define(),   // frontmatter --- delimiter
  blockPrim:   Tag.define(),   // ::: pagebreak / ::: toc etc.
  commentLine: Tag.define(),
};

// ─── StreamLanguage tokeniser ──────────────────────────────────────────────────

type TokenizerState = {
  inFrontmatter: boolean;
  frontmatterDone: boolean;
  lineIndex: number;
};

const docgentStream = StreamLanguage.define<TokenizerState>({
  name: "docgent",

  startState(): TokenizerState {
    return { inFrontmatter: false, frontmatterDone: false, lineIndex: 0 };
  },

  token(stream, state) {
    // Always consume the whole line; we do per-line tokens.
    // (StreamLanguage re-enters at line start after a non-null token.)

    // ── Frontmatter delimiter ─────────────────────────────────────────────────
    if (stream.sol()) {
      state.lineIndex++;

      // First line "---" starts frontmatter
      if (state.lineIndex === 1 && stream.match(/^---\s*$/)) {
        state.inFrontmatter = true;
        stream.skipToEnd();
        return "fmFence" as string;
      }
      // Closing "---" ends frontmatter
      if (state.inFrontmatter && !state.frontmatterDone && stream.match(/^---\s*$/)) {
        state.inFrontmatter = false;
        state.frontmatterDone = true;
        stream.skipToEnd();
        return "fmFence" as string;
      }
      if (state.inFrontmatter) {
        stream.skipToEnd();
        return null; // frontmatter body — no tint
      }

      // ── Page fence ───────────────────────────────────────────────────────────
      if (stream.match(/^---page\{/) || stream.match(/^---\/page---/)) {
        stream.skipToEnd();
        return "pageFence" as string;
      }

      // ── Block primitives ::: ─────────────────────────────────────────────────
      if (stream.match(/^:::(\s|$)/)) {
        stream.skipToEnd();
        return "blockPrim" as string;
      }

      // ── Directive blocks ::something{ ────────────────────────────────────────
      if (stream.match(/^::[a-zA-Z].*\{/)) {
        stream.skipToEnd();
        return "directive" as string;
      }

      // ── Headings ─────────────────────────────────────────────────────────────
      if (stream.match(/^# (?!#)/)) {
        stream.skipToEnd();
        return "heading1" as string;
      }
      if (stream.match(/^## (?!#)/)) {
        stream.skipToEnd();
        return "heading2" as string;
      }
      if (stream.match(/^### (?!#)/)) {
        stream.skipToEnd();
        return "heading3" as string;
      }
      if (stream.match(/^#{4,6} /)) {
        stream.skipToEnd();
        return "headingN" as string;
      }
    }

    // ── Inline tokens (character level) ──────────────────────────────────────
    // Bold **text**
    if (stream.match(/\*\*([^*]+)\*\*/)) return "bold" as string;
    // Italic *text* (not **)
    if (stream.match(/(?<!\*)\*([^*]+)\*(?!\*)/)) return "italic" as string;
    // Inline code `code`
    if (stream.match(/`[^`]+`/)) return "inlineCode" as string;

    // Advance one char so the tokeniser doesn't stall
    stream.next();
    return null;
  },

  // Carry frontmatter state across lines
  copyState(state): TokenizerState {
    return { ...state };
  },

  blankLine(state) {
    state.lineIndex++;
  },
});

// ─── Highlight style ───────────────────────────────────────────────────────────
// CM6's StreamLanguage wraps token names as Tag.define() descendants under
// the "other" tag group. We map via className rather than tags to keep things
// simple and avoids the styleTags plumbing that's only needed for Lezer grammars.

const docgentTheme = EditorView.baseTheme({
  ".dg-heading1":   { color: "#6b5bd6", fontWeight: "700", fontSize: "1.15em" },
  ".dg-heading2":   { color: "#6b5bd6", fontWeight: "650", fontSize: "1.08em" },
  ".dg-heading3":   { color: "#6b5bd6", fontWeight: "600" },
  ".dg-headingN":   { color: "#8b7ee0", fontWeight: "600" },
  ".dg-bold":       { color: "#1f4b6e", fontWeight: "700" },
  ".dg-italic":     { color: "#454e5a", fontStyle: "italic" },
  ".dg-inlineCode": {
    color: "#c7254e",
    background: "#f0f4f8",
    borderRadius: "3px",
    padding: "0 3px",
    fontFamily: "var(--mono, monospace)",
    fontSize: "0.92em",
  },
  ".dg-pageFence":  {
    background: "rgba(251,191,36,0.15)",
    color: "#92400e",
    fontWeight: "600",
    display: "block",
  },
  ".dg-directive":  { color: "#0e7490", fontWeight: "600" },
  ".dg-fmFence":    { color: "#8a94a1" },
  ".dg-blockPrim":  {
    background: "rgba(251,191,36,0.12)",
    color: "#92400e",
    fontWeight: "600",
    display: "block",
  },
});

// StreamLanguage token names map to CSS class names via the language's token
// table. CM6 emits `cm-TOKEN_NAME` on spans when using StreamLanguage, but we
// need `dg-*` prefixed names. We achieve this by renaming token types in the
// language definition token table approach — actually the simplest approach is
// to use a CSS class map via a custom highlighter extension.

// The real class names emitted by StreamLanguage are `cm-<tokenType>`.
// We add a baseTheme that covers both `.cm-heading1` (the actual class) and
// our semantic aliases so we don't need the `dg-` prefix at all.
const docgentStreamTheme = EditorView.baseTheme({
  ".cm-heading1":   { color: "#6b5bd6", fontWeight: "700", fontSize: "1.12em" },
  ".cm-heading2":   { color: "#6b5bd6", fontWeight: "650", fontSize: "1.06em" },
  ".cm-heading3":   { color: "#6b5bd6", fontWeight: "600" },
  ".cm-headingN":   { color: "#8b7ee0", fontWeight: "600" },
  ".cm-bold":       { color: "#1f4b6e", fontWeight: "700" },
  ".cm-italic":     { color: "#454e5a", fontStyle: "italic" },
  ".cm-inlineCode": {
    color: "#c7254e",
    background: "#f0f4f8",
    borderRadius: "3px",
    padding: "0 2px",
    fontFamily: "var(--mono, monospace)",
    fontSize: "0.91em",
  },
  ".cm-pageFence":  {
    background: "rgba(251,191,36,0.15)",
    color: "#92400e",
    fontWeight: "600",
  },
  ".cm-directive":  { color: "#0e7490", fontWeight: "600" },
  ".cm-fmFence":    { color: "#8a94a1" },
  ".cm-blockPrim":  {
    background: "rgba(251,191,36,0.12)",
    color: "#92400e",
    fontWeight: "600",
  },
});

// ─── Editor base styles ────────────────────────────────────────────────────────

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
  // Read-only state
  "&.cm-readonly .cm-content": {
    background: "var(--paper-alt, #f6f8fa)",
    cursor: "default",
  },
});

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the array of CodeMirror extensions that implement Docgent syntax
 * highlighting. Pass this to EditorState.create({ extensions: [...docgentLanguage()] }).
 */
export function docgentLanguage(): Extension[] {
  return [
    docgentStream,
    docgentStreamTheme,
    editorBaseTheme,
  ];
}
