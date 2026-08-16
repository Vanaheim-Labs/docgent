# Docgent

The document workspace for humans and AI agents. Git is the database — there is
no separate CMS store and no sync layer to get wrong.

Agents produce documents at volume via CLI/API. Humans make targeted edits in a
web UI (Studio). Both write to the same git history; an agent commit and a
human edit are the same kind of operation against the same objects.

## Architecture

Three layers, kept strictly separate:

- **Content** — the `.md` file. Semantics only. Never a colour, never a margin.
- **Semantics** — a closed, versioned vocabulary of block types (callouts, key
  figures, recommendations, KPI grids, etc.) — the contract between writer and
  designer.
- **Presentation** — CSS design tokens per brand. Owns `@page`, running
  headers, page breaks, typography.

If an author (human or agent) needs raw HTML to get an outcome, the vocabulary
is missing a term. Add the term; the validator hard-rejects the escape hatch.

Git-native version control, built for agent-speed editing:

- Every write carries the blob SHA it was based on. Stale writes are rejected
  (409), not silently overwritten — critical when agents and humans edit
  concurrently.
- **Semantic diffing** — rewrapping a paragraph reports zero changes; a
  changed key figure reports the specific before/after value. Blocks are
  matched across revisions by author-assigned identity, so a moved
  recommendation is recognised as moved, not deleted-and-recreated.
- **Content-addressed, immutable rendering** — every PDF is keyed to the exact
  commit that produced it.
- **Approval gates as ordinary git commits** — draft → review → approved →
  released → superseded, with sign-off captured as commit trailers
  (`Approved-By`, `Approved-At`).
- AI rewrites are proposals, never direct commits — a rewrite request returns
  text held in memory; a human sees a diff, and only an accepted proposal
  commits.

## Layout

```
packages/
  core/         md → html → pdf pipeline, brand token compiler, pluggable renderers
  git-store/    git-backed read/write layer (blob-SHA concurrency, GitHub API)
  vocabulary/   semantic block registry + validator
  cli/          docgent new|validate|render|brands|docs
brands/
  vanaheim/     Vanaheim Partners — brand.yaml tokens + overlay CSS
  inkl/         Inkl — brand.yaml tokens + overlay CSS
  northface/    North Face Investments — brand.yaml tokens + overlay CSS
apps/
  studio/       web UI (Next.js on Vercel) — editor, diff review, auth, per-brand access
  render-worker/ WeasyPrint rendering service (Fly.io container)
```

Documents themselves live in a separate git-backed documents repo per the
`DOCGENT_GH_TOKEN` convention — Studio reads/writes through the GitHub API,
the same way a human or agent CLI would.

## Requirements

- pandoc 3.x
- WeasyPrint 60+
- Node 20+

## Usage

```bash
node packages/cli/src/docgent.mjs brands
node packages/cli/src/docgent.mjs new --brand vanaheim --type "Strategy Memo" --title "Q3 Review"
node packages/cli/src/docgent.mjs validate documents/vanaheim/q3-review/doc.md
node packages/cli/src/docgent.mjs render documents/vanaheim/q3-review/doc.md
```

Renderer is pluggable — `--renderer chrome` swaps WeasyPrint for headless Chrome.

## Studio (web UI)

Next.js app on Vercel, served at `docs.docgent.io/<brand>/<slug>` — one domain,
brand resolved from the URL path (not per-brand subdomains). NextAuth-gated,
with per-brand agent bearer-token auth on the document API routes for
programmatic (agent) access alongside human sign-in.

Key API surface (`apps/studio/src/app/api/`):

- `docs/[brand]`, `doc/[brand]/[slug]` — document discovery + read
- `diff/[brand]/[slug]`, `status/[brand]/[slug]` — semantic diff, lifecycle status
- `rewrite/[brand]/[slug]` (+ `/accept`) — AI rewrite proposal → human-reviewed accept
- `render/[brand]/[slug]`, `preview/[brand]/[slug]` — PDF render, live HTML preview
- `restore/[brand]/[slug]` — one-click version restore
- `auth/check/[brand]` — per-brand access check

## Component gallery

`documents/vanaheim/kitchen-sink/doc.md` exercises every construct in the
vocabulary. Render it on every CSS change; treat a visual diff as a build
failure.

## Deployment

- **Studio** → Vercel, root directory `apps/studio`.
- **Render worker** → Fly.io (`docgent-render`, `syd` region). WeasyPrint
  cannot run on Vercel (needs native Pango/Cairo/HarfBuzz), so rendering runs
  in a container behind an HTTP API.

```bash
# Render worker deploy (re-stage whenever core CSS/templates/filters/brands change)
node apps/render-worker/stage.mjs
cd apps/render-worker && flyctl deploy --remote-only --app docgent-render
```

## Status (Aug 2026)

Core production pipeline, git-backed versioning, and read/write Studio UI are
built and deployed for three brands (Vanaheim, Inkl, North Face). The
DocForge → Docgent rebrand is complete across code, deploy configs, and
per-brand agent auth. Current focus: document discovery/auth-check API
endpoints for agent-driven access, ahead of the full agent-dispatch loop
(Slack/OpenClaw → proposal → diff → accept).

See `HANDOVER.md` for detailed operational notes, known traps, and outstanding
debts (machine-user GitHub identity for agent commits, Vercel deployment
protection).
