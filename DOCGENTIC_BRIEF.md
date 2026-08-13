# Docgent — Product Brief

## One-liner

Google Docs for AI agents and humans — the system of record that makes agent-produced documents trustworthy, versioned, and human-editable.

## The problem

AI agents (running through OpenClaw, triggered from Slack, connected to CRMs, data warehouses, research tools, and internal knowledge bases) can now produce genuinely good documents — strategy memos, client reports, board papers — in seconds, from a single prompt.

But production velocity creates a new problem: **version control, lost context, and human discretion become a nightmare.**

- An agent rewrites 40% of a document. What changed? Was it reviewed? Can a human easily undo just that section?
- Three different agent runs each propose a rewrite. Which one shipped? Where did the other two go?
- A human wants to strike a paragraph, reorder two sections, and hand the rest back to an agent for a different tone — without losing the audit trail of who changed what and why.
- Six months later: "what exactly did we send this client in March?" needs a real, retrievable answer — not a regenerated approximation that might render differently today.

Existing tools don't solve this. Google Docs has no concept of "agent-authored," no audit-grade diffing, no approval gates, no multi-brand design system. Git alone is illegible to non-technical reviewers. CMS platforms add a database and a sync layer — exactly the kind of state that breaks when agent and human edits happen concurrently.

## What Docgent is

A document production and collaboration system where **git is the database** — there is no separate CMS store, no sync layer, no reconciliation logic to get wrong.

Two producers, one source of truth:

- **Agents** produce at volume via CLI/API — triggered from a Slack prompt via OpenClaw, connected to arbitrary data sources — and commit directly to the same repository humans use.
- **Humans** make targeted edits in a web UI (Studio): split-pane markdown editor with live preview, section-level strike/reorder, inline AI-rewrite requests with diff-before-commit, and version timeline with one-click restore.

Both write to the same git history. An agent commit and a human edit are the same kind of operation against the same objects.

## Core architecture (already built)

**Three-layer separation, strictly enforced:**
- *Content* (the `.md` file) — semantics only, never a colour or a margin
- *Semantics* (a closed, versioned vocabulary of ~25 block types — callouts, key figures, recommendations, KPI grids, etc.) — the contract between writer and designer
- *Presentation* (CSS design tokens per brand) — owns all typography, page breaks, running headers

If an author (human or agent) needs raw HTML to get an outcome, the vocabulary is missing a term — the validator hard-rejects the escape hatch. This is what keeps diffs readable and the design system enforceable at any production volume.

**Git-native version control, built for agent-speed editing:**
- Every write carries the blob SHA it was based on. Stale writes are rejected (409), not silently overwritten — critical when agents and humans edit concurrently.
- Atomic multi-file commits (content + assets land as one commit, never a broken intermediate state).
- **Semantic diffing**: rewrapping a paragraph reports zero changes; a changed key figure reports the specific before/after value. Blocks are matched across revisions by author-assigned identity, so a moved recommendation is recognised as *moved*, not deleted-and-recreated. This is what makes reviewing a 40%-agent-rewritten document tractable for a human.
- **Content-addressed, immutable rendering** — every PDF is keyed to the exact commit that produced it. "What did we send in March" always has a real, retrievable answer, not a regeneration that may now render differently.
- **Approval gates as ordinary git commits** — draft → review → approved → released → superseded, with sign-off captured as commit trailers (`Approved-By`, `Approved-At`) that survive clone/mirror/export.

**Multi-brand from day one:** design tokens (typography, palette, page geometry, cover treatment) per brand, so the same system serves multiple clients/entities without forking.

**Rendering:** Markdown → Pandoc → WeasyPrint → PDF, chosen specifically for real running headers, proper footnotes, and reliable page-break control — the difference between "looks professional" and "looks generated." Rendering runs in a container (not serverless) because WeasyPrint needs native Pango/Cairo/HarfBuzz.

## The human-in-the-loop creative layer (in progress / roadmap)

The most distinctive part of the vision, and the part that makes this "collaboration," not just "pipeline":

- **AI rewrites are proposals, never direct commits.** A rewrite request returns text held in memory; the human sees a diff, and only an *accepted* proposal commits. Rejected variants never touch git. This is what makes "show me three takes" — three different models rewriting the same section — produce a clean decision record instead of commit-log noise.
- **Section-level control surface**: an outline view lets a human strike a section (undoable, commits only on save), reorder sections by drag, and leave inline annotations that the next AI pass reads as direction — without ever touching raw HTML or breaking the vocabulary contract.
- **Inline dispatch from the editor**: select any text, request a rewrite/expand/cut, route to a specific model, with "taste chips" (shorter / more direct / raise the stakes) as editable seeds rather than a rigid menu.
- **The OpenClaw connection**: the studio itself holds no AI credentials or routing logic — it's deliberately kept as a thin git client. Routing lives where agent orchestration already lives (OpenClaw), so "produce this document" can originate as a Slack prompt, run through whatever data sources and models are appropriate, and land back in Docgent as a reviewable, versioned proposal.

## Who it's for

Teams and consultancies where:
- Documents (strategy memos, client reports, board papers, investment memos) are a core deliverable
- AI is already producing first drafts or full drafts, but the current process for reviewing/trusting/versioning that output is ad hoc (Slack threads, Google Docs comment chains, "which version is final?")
- Multiple brands/clients/entities need distinct visual identity from the same underlying system
- Audit trail and approval history genuinely matter (compliance, client-facing deliverables, investor communications)

## What makes it defensible

Not "AI writes documents" (that's commodity). The moat is **making AI-speed document production auditable and human-controllable at the same time** — strict semantic/presentation separation, git-native concurrency control that treats a stale write as a real conflict rather than silent data loss, and a proposal-not-commit model for AI edits that keeps the version history meaningful instead of noisy.

## Current status

Core production pipeline, git-backed versioning, and read/write Studio UI are built and deployed (multi-brand support for Vanaheim, Inkl, North Face). The agent-dispatch loop (Slack/OpenClaw → proposal → diff → accept) and section-level human controls (strike/reorder/annotate) are the next build phase.

## Name rationale

**Docgent** = Doc + Agentic. Says exactly what it is on first hearing: documents, produced and shaped by agents, under human direction. No collisions found against existing trademarks, products, domains, or social handles at time of writing (Aug 2026) — a clean, ownable name in a category (`___Foundry`, `Doc + Gen/Genie/Genic`) that's otherwise heavily contested.
