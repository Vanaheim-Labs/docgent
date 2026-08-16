# Docgent — Backlog: described but not implemented

Generated 2026-08-16 from a review of the live site (docgent.io), the
`docgent-website` repo, and this repo (README, `DOCGENTIC_BRIEF.md`,
`HANDOVER.md` — including its §7b Phases 9-11 spec — and the actual API
route tree under `apps/studio/src/app/api/`, plus source in
`apps/studio/src/lib` and `apps/studio/src/components`).

**Scope note:** the "agent dispatch loop" (Slack/OpenClaw → proposal → diff →
accept) is **excluded** from this backlog. That mechanism is OpenClaw skills
territory (see `docgent-doc-access` skill), not something Docgent itself
needs to build — Studio is deliberately a thin git client with no AI
credentials or routing logic of its own. Everything below is scoped to
Docgent's own product surface.

Tracked as GitHub issues #1–#8. Not sequenced — each item is independently
shippable and can be picked up in any order, except where noted.

---

## Human-in-the-loop creative direction ([#1](https://github.com/Vanaheim-Labs/docgent/issues/1))

A full spec for this already exists in `HANDOVER.md` §7b ("Phases 9-11"),
settled 2026-08-09 with three architectural decisions Andrew already signed
off on: annotations are a vocabulary term (not HTML comments), strike/reorder
are deterministic text transforms (no serialiser), AI rewrites stay
proposals-not-commits. Three sub-phases, sequence matters: Phase 9
(legibility — edit/review toggle, outline, version filmstrip; zero risk,
start here) → Phase 10 (one `note` vocabulary term, strike, reorder) →
Phase 11 (AI direction loop: inline action bar, taste chips, three-takes,
depends on the OpenClaw-side dispatch endpoint).

## Review-action gaps ([#2](https://github.com/Vanaheim-Labs/docgent/issues/2))

Site's review mockup shows `Accept / Edit / Comment / Send back`. Backend
only implements the linear status lifecycle
(draft→review→approved→released→superseded, in `status/route.ts`) plus
rewrite propose/accept. No comment/thread data model exists. Real design
tension to resolve first: comments as git-native trailers/sidecar file (fits
"git is the database") vs. a real threaded side-store (breaks that
principle) — needs a decision, not just a ticket. "Send back" may already be
covered by the existing freeform `note` field on the status endpoint —
worth confirming before building anything new.

## Agent access ergonomics ([#3](https://github.com/Vanaheim-Labs/docgent/issues/3))

**Correction from the original scoping:** document discovery
(`GET /api/docs/[brand]`, with status/doctype filters) and per-brand agent
bearer tokens are both fully implemented already — confirmed by reading
`docs/[brand]/route.ts` and `lib/agent-auth.ts` directly. What's actually
still missing: an endpoint (or decision on open-vs-closed doctype set) to
list available doctypes/templates; brand creation, which is more of a
scaffolding-CLI question than a CRUD endpoint given brands carry CSS design
tokens; and self-serve agent token issuance (sequence after #5's
machine-user work).

## Site claims with no matching implementation ([#4](https://github.com/Vanaheim-Labs/docgent/issues/4))

- **MCP** — site lists it as a third integration path; zero MCP code exists.
  Would wrap the existing REST surface — not a rebuild.
- **JS SDK** — site's sample code (`docgent.documents.get()`,
  `revisions.propose()`) doesn't match any real endpoint shape. Either build
  a thin SDK wrapping the real REST API, or fix the sample.
- **DOCX export** — `HANDOVER.md` explicitly rules this out by design
  (wrong layer for the Pandoc/WeasyPrint architecture). Likely a
  **permanent** mismatch — recommend a copy fix, not an engineering ticket.

Needs a decision from Andrew on whether MCP/SDK are actually roadmapped
before committing engineering time.

## Machine user for agent commits ([#5](https://github.com/Vanaheim-Labs/docgent/issues/5))

From `HANDOVER.md` §9.1, flagged by Andrew as pressing. Production write
token is Andrew's personal `gh` CLI token (over-scoped, breaks on
rotation); agent commits are attributed to Andrew's own git identity, so the
audit trail no longer distinguishes agent- from human-authored changes (a
visible seam already exists in history from a prior agent identity). Fix:
one machine-user GitHub account + fine-grained PAT closes both problems.

## OpenClaw-facing CLI completeness ([#6](https://github.com/Vanaheim-Labs/docgent/issues/6))

From `HANDOVER.md` §7 ("Phase 7"), minus the Slack-dispatch mechanism
(excluded per scope note above). The `packages/cli` `docgent` tool already
covers `new|validate|render|brands|docs` — needs a completeness check
against what the docgent-doc-access skill actually requires, rather than
assuming a gap. Batch production and Workboard integration are separate,
lower-certainty items flagged for a decision rather than committed work.

## Multi-brand scale-out ([#7](https://github.com/Vanaheim-Labs/docgent/issues/7))

From `HANDOVER.md` §7 ("Phase 8"). Mostly operational readiness rather than
a single feature: per-brand doctype templates with distinct cover
treatment/scaffolding, a brand asset pipeline, and CI to validate/render
every brand's gallery on each PR (confirmed genuinely missing). Brand-scoped
access control may already be substantially covered by existing
`emailAllowedForBrand`/`brandsForEmail` — needs verification, not
assumed as a gap.

## Small polish items + deployment protection ([#8](https://github.com/Vanaheim-Labs/docgent/issues/8))

Grouped from `HANDOVER.md` §7 "known smaller items" and §9.2/9.3: a
`datatable` `widths` attribute that's declared but unused by the render
filter, a TOC-page running-header bug, a `git-check` cleanup path wanting
tidying, an unconfigured durable PDF cache (code exists, not turned on), and
Vercel deployment protection that's currently blocking even a manual
end-to-end smoke test of save/diff/status-transition paths. Low individual
risk; worth clearing opportunistically.
