# DocForge -> Docgent Rename -- Remaining Phases

Tracked 2026-08-13 by Mimir, per Andrew's request in #docgent.

## Done already (per git log in ~/.openclaw/workspace/docforge)
- ac11e7a -- rebrand: DocForge -> Docgentic (Phase 1: cosmetics)
- bfd9de9 -- rebrand: Docgentic -> Docgent (name changed before Phase 2)
- a4edc2a -- fix: correct leftover DocForge wordmark to Docgent in sidebar
- 09192f1 -- studio: show the Docgent logo top-left on every page
- e372a22 -- studio: revert duplicate topbar logos, keep single top-left mark
- 715875e -- studio: set explicit cache-control on SVG assets
- Marketing site (docgentic-site) already rebuilt under Docgent branding, domain docgent.io

## Remaining phases

### Phase 2 -- Public marketing surface (IN PROGRESS this session)
- Apply new website structure/copy from docgent-website-v2.md brief to docgentic-site/public/index.html
- Verify skill.md / openclaw-skill.json / publisher.pem still consistent (already Docgent-named)
- Confirm docgent.io DNS/hosting -- currently NOT resolving, needs deploy target set up

### Phase 3 -- Internal code identifiers (pipeline repo: Vanaheim-Labs/docforge)
- package.json name fields: docforge -> docgent (root + @docforge/cli, @docforge/core, @docforge/git-store, @docforge/vocabulary, @docforge/studio)
- Update internal require/import paths referencing @docforge/* package names
- Rename packages/cli/src/docforge.mjs -> docgent.mjs (update bin references)
- Source comments/headers referencing DocForge (yaml.mjs, render.mjs, lint.mjs, client.mjs, batch.mjs, index.mjs, semantic-diff.mjs, documents.mjs, validate.mjs)
- vocabulary.yaml header comment
- HTTP headers: X-DocForge-Key, X-DocForge-Render-Ms, X-DocForge-Cache, X-DocForge-Cache-Driver, X-DocForge-Request-Id -> X-Docgent-*
  - Coordinate render-worker + studio client + any external callers simultaneously (breaking header rename)
- Commit trailer string 'Generated-by: DocForge Studio' -> 'Generated-by: Docgent Studio' (accept route, store.ts regex, doc route, restore route)
  - Keep backward-compat regex matching both old and new trailer text so history doesn't break
- README.md files (root, git-store, studio, render-worker) -- drop '(formerly DocForge)' framing once rename is fully done, or keep as historical note
- HANDOVER.md -- full pass, or explicitly mark as historical/pre-rename document

### Phase 4 -- Repository & infra renames (higher risk, needs Andrew's go-ahead per step)
- GitHub repo rename: Vanaheim-Labs/docforge -> Vanaheim-Labs/docgent (GitHub auto-redirects clones/remotes, but CI/webhooks/tokens referencing old name need updating)
- Document store repos (separate from pipeline, contain actual client content):
  - Vanaheim-Labs/docforge-documents -> docgent-documents
  - north-face-investments/docforge-documents -> docgent-documents
  - inkldev/docforge-documents -> docgent-documents
  - Update brands/*/brand.yaml repo: fields to match new names after each rename
- Fly.io app: docforge-render -> docgent-render (Fly app renames require recreating the app -- flag to Andrew as a judgment call, may not be worth it)
  - fly.toml env var DOCFORGE_PIPELINE_DIR -> DOCGENT_PIPELINE_DIR (safe, internal only)
- Vercel project: docforge-studio -> docgent-studio (cosmetic, low risk if custom domain used)
- Token/secret naming: DOCFORGE_GH_TOKEN_NORTHFACE, DOCFORGE_GH_TOKEN_VANAHEIM, DOCFORGE_RENDER_URL, DOCFORGE_API_KEY -> DOCGENT_*
  - ~/.docforge/ directory could move to ~/.docgent/ -- coordinate with skills that hardcode the path

### Phase 5 -- Local tooling & skills (this machine, workspace-side)
- 8 skills still prefixed docforge-*: rename to docgent-* and update SKILL.md content
  - docforge-diff-change-type-sync, docforge-studio-deploy-verify, docforge-render-worker-fly-deploy,
    docforge-render-source-of-truth, docforge-add-brand, docforge-add-vocabulary-primitive,
    docforge-document-production, docforge-print-pagination-debug
- Local clone dir ~/.openclaw/workspace/docforge -> rename to ~/.openclaw/workspace/docgent (update git remote after Phase 4 repo rename)
- MEMORY.md / AGENTS.md references to DocForge -- update after each phase lands

### Phase 6 -- Final verification & cutover
- Full-text grep for remaining case-insensitive 'docforge' across pipeline repo, document stores, site, skills -- should return zero (except intentionally historical notes)
- Render a kitchen-sink document end-to-end to confirm nothing broke (headers, trailers, worker auth)
- Confirm docgent.io live and resolving, Studio reachable, render worker healthy
- Close out this plan doc / archive it

## Sequencing note
Phases 3 and 5 are safe without external coordination. Phase 4 involves repo/infra renames that could break live tokens, webhooks, or in-flight clones -- each repo rename gets a one-line go-ahead from Andrew before executing, one at a time, verifying health after each.
