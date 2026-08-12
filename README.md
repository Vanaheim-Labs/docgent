# Docgentic

(formerly DocForge) Multi-brand document production: version-controlled Markdown → semantic HTML → WeasyPrint → PDF.

Agents produce at volume via CLI. Humans edit surgically via web UI. Both write to the same
git-backed source of truth — git *is* the database, there is no separate CMS store and therefore
no sync layer.

## Architecture

Three layers, kept strictly separate:

- **Content** — the `.md` file. Semantics only. Never a colour, never a margin.
- **Semantics** — the fenced-div vocabulary. A documented, closed list. The contract between writer and designer.
- **Presentation** — CSS. Owns all of `@page`, running elements, page breaks, typography.

If an author needs raw HTML to get an outcome, the vocabulary is missing a term. Add the term;
the validator rejects the escape hatch.

## Layout

```
packages/
  core/         md → html → pdf pipeline, brand token compiler, pluggable renderers
  vocabulary/   semantic block registry + validator
  cli/          docforge new|validate|render|brands|docs
brands/
  vanaheim/     brand.yaml tokens + overlay CSS
documents/
  vanaheim/     one folder per document
apps/
  studio/       web UI (Next.js, Vercel)
  render-worker/ WeasyPrint service (container)
```

## Requirements

- pandoc 3.x
- WeasyPrint 60+
- Node 20+

## Usage

```bash
node packages/cli/src/docforge.mjs brands
node packages/cli/src/docforge.mjs new --brand vanaheim --type "Strategy Memo" --title "Q3 Review"
node packages/cli/src/docforge.mjs validate documents/vanaheim/q3-review/doc.md
node packages/cli/src/docforge.mjs render documents/vanaheim/q3-review/doc.md
```

Renderer is pluggable — `--renderer chrome` swaps WeasyPrint for headless Chrome.

## Component gallery

`documents/vanaheim/kitchen-sink/doc.md` exercises every construct in the vocabulary.
Render it on every CSS change; treat a visual diff as a build failure.

## Deployment

Studio on Vercel. WeasyPrint cannot run on Vercel (Python + native Pango/Cairo/HarfBuzz),
so rendering runs in a container (Fly.io / Cloud Run) behind an HTTP API.
