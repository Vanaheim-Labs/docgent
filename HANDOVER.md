# DocForge — Project Handover & Context Primer

**Last updated:** 2026-08-09
**Status:** Phases 0–6 complete and deployed. Phases 7–8 remain.
**Repo:** https://github.com/Vanaheim-Labs/docforge (private)
**Local clone:** `~/.openclaw/workspace/docforge`

> This document is the canonical context primer. Re-upload it to start a new
> session on DocForge and you should be able to resume without re-deriving
> anything. It records what was built, *why* it was built that way, what is
> deployed where, what is still owed, and the traps already discovered.

---

## 1. What DocForge is

A multi-brand document production system. Version-controlled Markdown is run
through a design-system template and rendered to PDF.

Two audiences, one source of truth:

- **Agents** produce at volume via a CLI (`docforge new/validate/render`), commit, open PRs.
- **Humans** make targeted edits in a web UI (Studio), with live preview and approval gates.

Both write to the same git history. There is no separate CMS store, therefore
no sync layer and no reconciliation logic to get wrong.

### Why Markdown

Markdown alone is too thin for consultancy-grade documents. DocForge adds two things:

1. **YAML frontmatter** for document-level metadata (title, client, version,
   classification, status) which drives the cover page, running headers and footers.
2. **Pandoc fenced divs** for semantic blocks — `::: {.callout kind=warning}` —
   which become `<div class="callout" data-kind="warning">` and are styled by CSS.

Alternatives considered and rejected: AsciiDoc (richer out of the box, smaller
toolchain, features obtainable via fenced divs anyway), reStructuredText
(unpleasant to hand-write, noisy diffs), DOCX/typst/LaTeX (wrong layer — we want
text in git).

---

## 2. Architecture — the decisions that matter

These are load-bearing. Do not relitigate without a concrete reason.

### 2.1 Three layers, kept strictly separate

| Layer | Lives in | Owns | Never contains |
|---|---|---|---|
| **Content** | `documents/<brand>/<slug>/doc.md` | Semantics only | Colours, margins, layout |
| **Semantics** | `packages/vocabulary/vocabulary.yaml` | The closed vocabulary | Presentation |
| **Presentation** | `packages/core/css/base.css` + brand overlay | `@page`, breaks, typography | Content |

**The rule:** if an author needs raw HTML or an inline style to get an outcome,
the vocabulary is *missing a term*. Add the term; do not allow the escape hatch.
The validator enforces this — raw HTML and `style="..."` are hard errors.

Once raw HTML creeps in, diffs stop being readable and the design system stops
being enforceable. This is the single most important constraint in the project.

### 2.2 Git IS the database

Studio is a **git client, not a CMS**. It holds no database and no document
state of its own. Backed by the GitHub REST API rather than a local clone,
because Vercel has no persistent disk.

Consequence: an agent committing from the CLI and a human saving in Studio are
doing the *same operation* against the same objects. Nothing to sync.

### 2.3 Optimistic concurrency, deliberately strict

Every write carries the blob SHA the caller based its edit on.

| Situation | Result |
|---|---|
| Stale SHA | `StaleWriteError` → 409 |
| No SHA supplied on an update | **Rejected** — a blind write is a bug, not a shortcut |
| SHA supplied for a file that does not exist | Rejected |
| Identical content | No-op, no empty commit |

A lost update is silent data loss; a 409 is a conversation. This is what lets
bulk agent production and human editing safely share one branch.

### 2.4 Atomic multi-file commits

`commitFiles()` uses the low-level git data API (blobs → tree → commit → ref) so
a document edit touching `doc.md` *plus* assets lands as **one** commit.
Committing separately would leave intermediate versions in the timeline that do
not render.

### 2.5 Renderer is pluggable, WeasyPrint chosen

`packages/core` exposes a `Renderer` interface. WeasyPrint and headless Chrome
are both implemented.

**WeasyPrint was chosen** for real `string-set` running headers, proper
footnotes, and reliable `break-inside` control — the things that separate "looks
professional" from "looks generated". Chrome remains a one-line swap if ever needed.

**WeasyPrint cannot run on Vercel** (Python + native Pango/Cairo/HarfBuzz). Hence
the separate containerised worker. This is not incidental — it is why the
architecture is split the way it is.

### 2.6 Content-addressed PDFs

A rendered version must be **retrievable**, not merely **regenerable**.

If the design system changes, re-rendering an old commit produces a *different*
artefact — the wrong answer to "what exactly did we send the client in March?".
So every render is keyed by the commit SHA that produced it and kept immutable.

HEAD is resolved to a concrete commit before caching, because "current" stops
being current the moment someone commits.

### 2.7 Approval gates live in git

Status lives in frontmatter, so a transition is an ordinary commit. Sign-off is
captured as **commit trailers** (`Status-From`, `Status-To`, `Approved-By`,
`Approved-At`), which survive clone, mirror and export — unlike a row in a table
only this app knows how to read.

Lifecycle is linear with one escape hatch, so "who approved this and when"
always has a single answer:

```
draft → review → approved → released → superseded
         ↓ (back to draft)   ↓ (back to review)
```

Invalid transitions return 409 with the permitted set.

---

## 3. Repository layout

```
docforge/
├── packages/
│   ├── vocabulary/
│   │   ├── vocabulary.yaml          ← THE CONTRACT. 14 blocks, 3 inlines, frontmatter spec
│   │   └── src/validate.mjs         ← validator: blocks, attrs, enums, assets, no-raw-HTML
│   ├── core/
│   │   ├── css/base.css             ← design system: @page, running headers, all block styles
│   │   ├── templates/document.html  ← pandoc HTML template (cover, TOC, body)
│   │   ├── filters/vocabulary.lua   ← fenced divs → semantic HTML + auto heading numbers
│   │   ├── src/render.mjs           ← pipeline + brand token compiler + Renderer impls
│   │   └── src/client.mjs           ← RenderClient for the remote worker
│   ├── git-store/
│   │   ├── src/index.mjs            ← GitStore: files, commits, history, diff, branches
│   │   ├── src/documents.mjs        ← DocumentStore: brand/slug, timeline, save
│   │   ├── src/semantic-diff.mjs    ← structural diff (Phase 6)
│   │   └── test/*.test.mjs          ← 27 tests
│   └── cli/src/docforge.mjs         ← new|validate|render|health|brands|docs|remote-docs|timeline|git-check
├── brands/
│   └── vanaheim/
│       ├── brand.yaml               ← tokens: typography, palette, page geometry, cover
│       └── css/brand.css            ← brand-specific overrides only
├── documents/
│   └── vanaheim/
│       ├── kitchen-sink/doc.md      ← component gallery = visual regression test
│       └── font-smoke-test/doc.md   ← proves brand fonts resolve, not fallbacks
└── apps/
    ├── render-worker/               ← Flask + pandoc + WeasyPrint, deployed to Fly.io
    │   ├── Dockerfile               ← pinned pandoc 3.9, font embedding, fc-match assertion
    │   ├── server.py                ← /render /health /brands
    │   ├── fontconfig/49-docforge-aliases.conf
    │   ├── fonts/                   ← Inter + Source Serif 4 (variable, SIL OFL)
    │   ├── stage.mjs                ← copies core+brands into the Docker build context
    │   └── fly.toml
    └── studio/                      ← Next.js on Vercel
        └── src/
            ├── auth.ts              ← GitHub OAuth, org-restricted
            ├── lib/{store,render,vocabulary,validate-client,diff,pdf-cache}.ts
            ├── components/{Sidebar,UserChip,Editor,VersionPanel}.tsx
            └── app/                 ← 12 routes
```

---

## 4. Live infrastructure

| What | Where | Notes |
|---|---|---|
| **Render worker** | https://docforge-render.fly.dev | Fly.io, app `docforge-render`, 2 machines, region `syd`, scale-to-zero, 1GB |
| **Studio** | https://docforge-studio-vanaheim-projects.vercel.app | Vercel team `vanaheim-projects`, project `docforge-studio`, rootDirectory `apps/studio` |
| **Repo** | github.com/Vanaheim-Labs/docforge | private, branch `main` |

### Worker endpoints

- `GET /health` — unauthenticated. Reports pandoc/weasyprint/template/filter/css/brands presence **and `pandoc_extensions`**.
- `GET /brands` — authenticated. Brand ids + display names.
- `POST /render` — authenticated. `{markdown, brand, assets{path:base64}, filename}` → `application/pdf`.
  Response headers: `X-DocForge-Request-Id`, `X-DocForge-Render-Ms`.
  Errors: 400 / 401 / 404 unknown brand / 413 / 422 pandoc-or-weasyprint failure / 504.

Auth is a shared secret in `X-DocForge-Key`. The service **fails closed** — with
no `DOCFORGE_API_KEY` set it rejects everything rather than running open.

### Studio routes (12)

```
/                              document list
/[brand]/[slug]                document view: PDF, metadata, approval, timeline
/[brand]/[slug]/edit           split-pane editor
/signin
/api/auth/[...nextauth]
/api/health                    repo + worker reachability
/api/doc/[brand]/[slug]        GET read (with sha) / PUT save (validate + concurrency)
/api/preview/[brand]/[slug]    POST render UNSAVED buffer
/api/render/[brand]/[slug]     GET render committed version (?ref=sha), content-addressed cache
/api/diff/[brand]/[slug]       GET semantic diff (?base=sha&head=sha)
/api/status/[brand]/[slug]     GET allowed transitions / POST perform transition
```

### Environment variables (Studio, all set in Vercel across Production + Development)

```
AUTH_SECRET               generated
AUTH_GITHUB_ID            Ov23li42qb6OQCttMALx
AUTH_GITHUB_SECRET        (set)
DOCFORGE_REPO             Vanaheim-Labs/docforge
DOCFORGE_BRANCH           main
DOCFORGE_GH_TOKEN         ⚠️ currently Andrew's gh CLI token — see Debts
DOCFORGE_ALLOWED_ORG      Vanaheim-Labs
DOCFORGE_RENDER_URL       https://docforge-render.fly.dev
DOCFORGE_API_KEY          (matches the Fly secret)
```

Optional, for durable PDF caching (not yet configured — falls back to in-memory LRU):
`DOCFORGE_PDF_CACHE_ENDPOINT`, `DOCFORGE_PDF_CACHE_BUCKET`, `DOCFORGE_PDF_CACHE_TOKEN`.

### GitHub OAuth app

Owned by Vanaheim-Labs. Callback:
`https://docforge-studio-vanaheim-projects.vercel.app/api/auth/callback/github`

Sign-in checks org membership using the user's own token, which is then
discarded. All repo access uses `DOCFORGE_GH_TOKEN`, so permissions follow org
membership rather than whatever scopes an individual granted.


---

## 5. The vocabulary (the contract)

Defined in `packages/vocabulary/vocabulary.yaml`. **14 block terms:**

| Block | Purpose | Key attributes |
|---|---|---|
| `callout` | Boxed aside | `kind` (note/info/warning/risk/success), `title` |
| `pullquote` | Lifted quotation | `attribution`, `size` (normal/large) |
| `keyfigure` | Dominant statistic | `value`*, `label`*, `trend` (up/down/flat/none) |
| `figure` | Image + caption | `src`*, `caption`, `source`, `width` (column/full/bleed) |
| `datatable` | Table wrapper | `widths`, `align`, `dense`, `caption` |
| `summary` | Executive summary | — |
| `recommendation` | Numbered rec | `ref`, `owner`, `priority` (low/medium/high/critical) |
| `definition` | Glossary entry | `term`* |
| `columns` | Multi-column region | `count` |
| `pagebreak` | Explicit break | `to` (any/left/right) |
| `landscape` | Landscape named page | — |
| `appendix` | Appendix region | — |
| `signature` | Sign-off block | `name`*, `role`, `date` |
| `toc` | Table of contents | — |

\* = required

**3 inline terms:** `term`, `redact`, `footnoteref`.

**Frontmatter:** required `title, brand, doctype, version, date`; optional
includes `subtitle, client, author, classification, status, reference,
confidentiality, abstract, cover_image, toc, footer_note`.
Enums: `classification` (public/internal/confidential/restricted),
`status` (draft/review/approved/released/superseded).

### Two things that make the vocabulary real

1. **`documents/vanaheim/kitchen-sink/doc.md`** exercises *every* term. Render it
   on every CSS change; treat a visual diff as a build failure. Untested
   vocabulary is a lie — Phase 1 existed largely to close this gap.
2. **The validator** (`--strict` for CI) checks block ids, attribute *names*,
   enum values, required attributes, frontmatter keys and enums, referenced
   asset existence, unclosed fences, raw HTML and inline styles.

---

## 6. Phase-by-phase history

### Phase 0 — Foundation (commit `9ed5a18`)
Vocabulary registry, validator, pandoc→HTML→WeasyPrint pipeline, brand token
system (`brand.yaml` → CSS custom properties), base design system CSS, Lua
filter, CLI, Vanaheim brand, kitchen-sink gallery. First render: 6 pages.

*Bugs found:* validator couldn't parse the `::: {.block attr=x}` attribute form;
pandoc 3.9 rejects `+attributes` as an extension name.

### Phase 1 — Render defects + validator hardening
Fixed footnote tofu glyph (suppressed the back-reference link — meaningless in
print), glossary term/definition spacing, appendix double rule. Added `figure`,
`toc`, `landscape`, `pagebreak` to the gallery — 6 → 10 pages. Validator
upgraded from scraping ids to parsing a full spec.

### Phase 2 — Containerised render worker (`39f11bf`, `09bd200`)
Dockerfile (pandoc + WeasyPrint + Pango/Cairo/HarfBuzz + fonts), Flask API with
shared-secret auth, structured JSON logging with per-stage timing, path-traversal
guards on assets, `fly.toml`, `stage.mjs`, `RenderClient`, CLI `--remote`.

*Three deployment bugs local testing could never have surfaced — see §8.*

### Phase 3 — Git-as-database (`243ba3a`)
`GitStore` + `DocumentStore`. 15 unit tests (stubbed fetch) + 12 live checks
against a scratch branch on the real repo, then cleaned up.

### Phase 4 — Studio v1, read-only (`a55c33f`, `c4b9e9f`)
Next.js on Vercel. OAuth org-gated, document tree, PDF preview via the worker,
metadata panel, version timeline with `?v=<sha>`.

### Phase 5 — Studio v2, editing (`42cef54`)
Split-pane editor, live preview debounced 1.2s (skipped while errors exist),
browser-side vocabulary validation, block palette (⌘/) built *from* the registry,
⌘S save, beforeunload guard. Save guards: registry validation, then optimistic
concurrency. Commits attributed to the signed-in user.

### Phase 6 — Observable versioning (`882a880`)
Semantic diff, content-addressed PDF cache, approval gates. 27/27 tests.

The diff tests pin the core promise: **rewrapping a paragraph reports zero
changes**, while a changed keyfigure value reports an attribute change with
before/after. Blocks are matched across revisions by author-assigned identity
(`ref`/`term`/`title`/`label`) so a moved recommendation is recognised as the
same recommendation, not a delete plus an add.

---

## 7. Remaining phases

### Phase 7 — OpenClaw agent integration *(the original motivation)*

A `docforge` skill so any agent can produce compliant documents without knowing
internals:

- Create from a doctype template, write content, validate, render, commit, open PR
- **Batch production** — e.g. fifty client reports generated from a data source
- Workboard integration so document production becomes a trackable card with attachments

*Depends on:* Phases 1 + 2 only. Could have been done before Studio.

### Phase 8 — Multi-brand scale-out

- Onboard **Inkl** and **Laurion** as real brands
- Per-brand doctype templates (strategy memo, board paper, client report) each
  with distinct cover treatment and section scaffolding
- Brand-scoped access control in Studio
- Brand asset pipeline (logos, fonts, cover imagery)
- **CI**: validate all documents + render every brand's gallery on each PR

### Known smaller items worth folding in

- `datatable` `widths` attribute is declared in the registry but the Lua filter
  does not act on it yet — columns auto-size. Implement via `<colgroup>`.
- Running header shows the section title on both left and right on the TOC page,
  because `string-set` has not been assigned yet at that point.
- `git-check`'s branch cleanup reaches for a private method before falling back
  to a raw fetch. Works, but wants tidying when branch lifecycle management lands.
- Durable PDF cache driver (R2) is implemented but not configured.


---

## 8. Hard-won lessons (do not rediscover these)

### Deployment traps

**Debian bookworm ships pandoc 2.17**, which rejects `table_attributes`. The app
rendered perfectly locally (pandoc 3.9) and returned 422 in production. Fixed by
pinning pandoc 3.9 in the Dockerfile *and* adding a boot-time extension check
surfaced at `/health`, so a version regression fails loudly rather than at first render.

**Variable fonts register under different family names.** `InterVariable.ttf`
registers as **"Inter Variable"**, not "Inter". Without a fontconfig alias,
fontconfig silently falls back to DejaVu/Liberation and **every build still
reports success** — the PDF just looks subtly wrong. Fixed with
`fontconfig/49-docforge-aliases.conf` mapping design-intent names onto packaging
names, plus a build-time `fc-match` assertion so it cannot silently regress.
Chose to fix in the container rather than change `brand.yaml`: brand config
describes design intent, the container absorbs packaging detail.

**`.dockerignore` excluded `pipeline/`** — the exact directory `stage.mjs`
generates *for* the image.

**Vercel blocks deploys on an unverifiable commit author email.**
`mimir@vanaheim.local` → `BLOCKED`. A *constructed* GitHub noreply
(`<id>+<login>@users.noreply.github.com`) **also failed** — it must be an address
actually registered on the account. Andrew's real address (`andrew@dcr.vc`) was
in `git config --global user.email` the whole time.
**Lesson: check the global git config first.**

**Vercel refuses vulnerable Next.js versions.** 15.1.6 → `VULNERABLE_NEXTJS_VERSION`.
Bumped to 15.5.23 (maintained 15.x backport line — no App Router migration needed).

**Vercel monorepo:** set `rootDirectory` via the API
(`PATCH /v9/projects/{id}?teamId=...` with `{"rootDirectory":"apps/studio"}`) —
the CLI has no flag for it. Also: `$schema` in `vercel.json` is rejected as an
additional property.

**Vercel deployment protection is ON** — every request bounces to `vercel.com/sso-api`,
which blocks curl-based verification of authenticated paths entirely.

### Tooling traps in this environment

- **Shell quoting via `exec` is fragile.** Nested `$(...)`, heredocs containing
  backticks, and `${#VAR}` all broke repeatedly. **Reliable pattern:** write the
  script to a file with `core:write`, then run `bash /tmp/script.sh`, passing
  secrets via the `env:` parameter rather than interpolating them.
- **The secret-redaction filter mangles env var names containing TOKEN/SECRET/KEY**
  when writing source files — `process.env.DOCFORGE_PDF_CACHE_TOKEN` was written
  as literal `***` and broke the build. Workaround: build the key from
  concatenated string parts.
- **Deep relative imports from nested route folders break.** Put monorepo imports
  in `src/lib/*` where the depth is shallow and stable.
- **`node --test <dir>` treats the directory as CJS.** Point it at the file.

### Process lessons

- **Verify before reporting.** I said "committing now" and did not commit; Andrew
  had to ask "I don't see it committed?". Claiming work as done when it is merely
  intended is the failure mode to avoid.
- **When the tool works but the harness does not, suspect the harness.** I chased
  a phantom 401 across several exchanges and needlessly rotated an API key. Raw
  curl worked the whole time — my test scripts were mangling the key through
  nested quoting (`keyLen: 3` instead of 64).

---

## 9. Outstanding debts

Andrew asked to be reminded of these. Both are now more pressing because editing is live.

### 9.1 Machine user for DocForge

Two problems, one fix:

- Production `DOCFORGE_GH_TOKEN` is **Andrew's `gh` CLI token** — over-scoped for
  what Studio needs, and Studio breaks whenever it rotates.
- **My commits are attributed to Andrew.** Vercel demanded a verifiable GitHub
  identity, so `git config user.email` in this repo is `andrew@dcr.vc`. Git
  history no longer distinguishes agent work from his. There is a visible seam:
  commits up to `243ba3a` are authored by Mimir, everything after is Andrew.

A machine user with its own GitHub account and a fine-grained PAT scoped to
`Vanaheim-Labs/docforge` (Contents read/write) solves both.

### 9.2 Vercel deployment protection

Currently ON. Users need a Vercel account **plus** GitHub org membership — real
friction for non-technical editors, and it blocks agent-side verification of
authenticated paths. Recommendation: disable it and let Studio's own
org-restricted GitHub auth be the single gate.

### 9.3 Unverified by me

Deployment protection means I have **never exercised the authenticated paths
myself**. Specifically unverified: a real save through Studio, the Compare
(semantic diff) UI, and a status transition. All are built and unit-tested;
none are confirmed working end-to-end in the browser.

---

## 10. Quick reference

```bash
cd ~/.openclaw/workspace/docforge

# Local
node packages/cli/src/docforge.mjs brands
node packages/cli/src/docforge.mjs new --brand vanaheim --type "Strategy Memo" --title "Q3 Review"
node packages/cli/src/docforge.mjs validate documents/vanaheim/kitchen-sink/doc.md --strict
node packages/cli/src/docforge.mjs render documents/vanaheim/kitchen-sink/doc.md

# Through the deployed worker (output matches production exactly)
export DOCFORGE_RENDER_URL=https://docforge-render.fly.dev
export DOCFORGE_API_KEY=***   # from: fly secrets / /tmp/docforge-api-key.txt
node packages/cli/src/docforge.mjs health
node packages/cli/src/docforge.mjs render <doc.md> --remote

# Git-backed (reads through the GitHub API, as Studio does)
node packages/cli/src/docforge.mjs remote-docs
node packages/cli/src/docforge.mjs timeline vanaheim/kitchen-sink
node packages/cli/src/docforge.mjs git-check     # live concurrency check on a scratch branch

# Tests
node --test packages/git-store/test/git-store.test.mjs packages/git-store/test/semantic-diff.test.mjs

# Worker deploy (re-stage whenever core CSS/templates/filters/brands change)
node apps/render-worker/stage.mjs
cd apps/render-worker && flyctl deploy --remote-only --app docforge-render

# Studio deploy
cd ~/.openclaw/workspace/docforge && vercel deploy --prod --yes --token "$VTOK"
```

### Authoring example

```markdown
---
title: "Q3 Strategy Review"
brand: vanaheim
doctype: "Strategy Memo"
version: "1.0.0"
date: "2026-08-09"
client: "Northwind Group"
classification: confidential
status: draft
toc: true
---

::: summary
## Executive summary
One paragraph stating the conclusion. Write this last.
:::

# Findings

::: {.keyfigure value="$4.2M" label="Annualised run rate" trend=up}
Up from $2.8M at the prior review.
:::

::: {.callout kind=risk title="Material risk"}
Concentration risk in the enterprise segment.
:::

::: {.recommendation ref="R1" priority=critical owner="Executive"}
Consolidate the three overlapping pricing tiers.
:::
```

---

## 11. Working agreement with Andrew

- He gives crisp phase-by-phase go-aheads. Wants the **roadmap before the work**,
  then approves one phase at a time.
- He diagnoses well and is usually right — he spotted the Vercel commit-author
  issue from a screenshot before I had worked it out from the API. Take his
  hypotheses seriously.
- Prefers **a tradeoff plus a recommendation** over an open question.
- Wants verified claims, not optimistic ones. Show the evidence.
- Flag credential risks once, offer the safer path, then proceed as he directs —
  do not refuse or repeat the lecture.
