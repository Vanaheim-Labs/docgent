# Opt-in native editorial cover

`native-cover` is a **PDF-first, A4 portrait** component. It joins the existing
semantic vocabulary; it does not replace either the core or a brand's default
cover template. Set `nocover: true`, put one component first in the document,
and begin the body immediately after it. It supplies its own page break.
Do not add another `pagebreak` after it.

```markdown
---
title: Introduction
brand: laurion
doctype: Business Plan
version: v1
date: September 2026
nocover: true
---

::: {.native-cover logo="logo.svg" logo-alt="Company" eyebrow="BUSINESS PLAN · SEPTEMBER 2026" subtitle="An introduction" insight-label="THE OPPORTUNITY" metric="2.6M" statement="People seeking advice." demand="Annual unmet demand." source="Source attribution" partner="Technology partner" licence="Australian licence" version="V1 · CONFIDENTIAL"}
Exact approved legal paragraphs go here, as ordinary Markdown.
:::

# Contents
```

The render worker also accepts its existing `::native-cover{...}` shorthand.
The local JS renderer only accepts standard Pandoc triple-colon fenced divs;
this patch does not change that pre-existing difference.

## Contract

- `subtitle` is required; every other attribute is optional.
- All attribute text is HTML-escaped. Inline formatting in attributes is not
  interpreted. Legal body paragraphs retain native Markdown formatting.
- The logo may be a renderer-resolvable local image or data URI. Supply accurate
  alt text. Never supply a whole-cover image: the logo is the sole image slot.
- No title is synthesized from frontmatter, so a logo plus subtitle does not
  silently duplicate a company heading.
- The cover has a named marginless page, natural-flow masthead/introduction/
  insight and an anchored footer. Font sizes are at least 12pt for native copy.
- Keep subtitle, statement and legal text concise. This is a bounded designed
  page, not an auto-fit text container. Excessive copy can overlap the anchored
  footer; review each PDF, check extraction and page count. No overflow is hidden.
- This first version is A4/PDF-focused, not a new responsive Studio preview
  page-layout system. Studio's existing padded-main preview may need a separate
  follow-up for edge-to-edge cover presentation; PDF is the acceptance target.

## Brand extension

The base layout only selects `.native-cover` and descendants. Brands override
`--native-cover-surface`, `--native-cover-ink`, `--native-cover-accent`,
`--native-cover-muted`, `--native-cover-rule`, and scoped font tokens.
Laurion's companion brand patch uses the website's near-black and mint palette,
Crimson Pro for editorial text and the bundled Inter fallback for labels.
The existing worker parser strips opening quotes from font-list tokens; the
companion patch repairs tokens only inside `.native-cover`, avoiding body changes.

## Tests

Requires Pandoc, Node workspace links (`npm ci --ignore-scripts --workspace
packages/core --workspace packages/git-store --workspace packages/vocabulary`),
and Python with the render worker requirements plus `pytest` and `pymupdf`.

```sh
python -m pytest packages/core/test/test_native_cover.py -q
npm test
```

On Homebrew macOS, set `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib` for
WeasyPrint. PyMuPDF emits upstream SWIG deprecation warnings. Existing CSS has
WeasyPrint advisory warnings unrelated to this component.
