# Docgent — Described-but-not-implemented Roadmap

Generated 2026-08-16 from a review of the live site (docgent.io), the
`docgent-website` repo, and this repo (README, `DOCGENTIC_BRIEF.md`,
`HANDOVER.md`, actual API route tree under `apps/studio/src/app/api/`).

**Scope note:** the "agent dispatch loop" (Slack/OpenClaw → proposal → diff →
accept) described in the brief as the next build phase is **excluded** from
this roadmap. That mechanism is OpenClaw skills territory (see
`docgent-doc-access` skill), not something Docgent itself needs to build —
Studio is deliberately a thin git client with no AI credentials or routing
logic of its own. Everything below is scoped to Docgent's own product surface.

Phases are priority-ordered, not strictly sequential — each is independently
shippable.

---

## Phase 1 — Section-level human controls

Promised in `DOCGENTIC_BRIEF.md` under "the human-in-the-loop creative layer"
as in progress/roadmap. None of this exists yet in `apps/studio`.

- Strike a section (undoable, commits only on save)
- Drag-reorder sections
- Inline annotations that the next AI rewrite pass reads as direction
- Inline dispatch from the editor: select text → rewrite/expand/cut, routed
  to a specific model
- "Taste chips" (shorter / more direct / raise the stakes) as editable
  rewrite seeds rather than a rigid menu

## Phase 2 — Review-action gaps

Site's review mockup shows `Accept / Edit / Comment / Send back` as
first-class actions. Backend only implements a linear status lifecycle
(draft→review→approved→released→superseded) plus rewrite propose/accept.
No comment/thread data model exists — the one `comment` hit in the codebase
is an unrelated code-comment in a markdown parser, not a feature.

- Comment/annotation thread on a document or section, visible in Studio
- "Send back" as a distinct action from a plain status demotion — i.e.
  attaching feedback/reason when returning a proposal to an agent

## Phase 3 — Agent access ergonomics

Flagged directly in the brief and README as in-progress/not done. README:
"Current focus: document discovery/auth-check API endpoints for
agent-driven access."

- Endpoint to list a brand's available doctypes/templates remotely (agents
  currently have to be told, or infer from an existing example doc)
- Endpoint to create a brand (currently manual: brand.yaml + repo + token)
- Self-serve agent token issuance (currently manual, per HANDOVER/skill doc)

## Phase 4 — Site claims with no matching implementation

Marketing copy ahead of what's built or, in one case, ahead of what's
architecturally intended.

- **MCP** — site lists "REST API / MCP / OpenClaw" as three integration
  paths. No MCP server/code anywhere in the repo — REST only.
- **JS SDK** — site's developer sample uses `docgent.documents.get()` /
  `docgent.revisions.propose()`. No SDK package exists; only raw REST routes,
  with a different verb/shape (`/api/rewrite` propose→accept, not
  `revisions.propose`/`submit`).
- **DOCX export** — site says documents render to "PDF, DOCX or web."
  `HANDOVER.md` explicitly rules DOCX out as the wrong layer for this
  architecture. This is a likely **permanent** site/product mismatch, not a
  backlog item — needs a messaging decision, not an engineering one.

## Phase 5 — Operational debt (blocks safely scaling agent writes)

Not user-facing functionality, but named directly in `HANDOVER.md` §9 as
pressing now that editing is live.

- Machine user for Docgent: dedicated GitHub account + fine-grained PAT,
  replacing the current production `DOCFORGE_GH_TOKEN` (Andrew's personal
  `gh` CLI token — over-scoped, breaks on rotation)
- Agent commits are currently attributed to Andrew's own git identity
  (`git config user.email` = `andrew@dcr.vc`) — no distinction in history
  between agent-authored and human-authored commits past a certain point
