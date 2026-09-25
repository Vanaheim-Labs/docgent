# Unified document workspace — local delivery evidence

## Scope and baseline

Isolated repository baseline: `7d8d2c35abea071c934ff41cec320b12492dfcb9`.
Branch: `feat/unified-document-workspace`. No push, merge, deployment, provider configuration change or customer-document mutation performed. Other checkouts and open PRs 27/29 were not edited.

Baseline `npm test` passed; its final test runner reported 172 passing, zero failing. Full output: `/tmp/docgent-unified-baseline.log`. These are runner totals, not an aggregate across npm workspaces.

## Audit and reuse map

| Contract | Inspected implementation | Delivery |
|---|---|---|
| Reader/edit routing | `app/[brand]/[slug]/page.tsx`, `edit/page.tsx`, `DocumentWorkspace.tsx` | Flag selects shared `Editor` workspace; old routes and legacy fallback retained; brand authorization precedes flagged edit content reads. |
| Authoring | `components/Editor.tsx`, CodeMirror, existing visual block parsing | Reused authoring engines. Independent Visual/Source and pane layout, persisted authoring choice, narrow-screen single pane toggle. Unsupported formatted blocks refuse destructive visual edits. |
| Save | `api/doc/[brand]/[slug]/route.ts`, git-store documents | Existing guarded PUT retained; serialize client saves, preserve typing during save, capture immutable revision for unchanged saves and verify pinned bytes. Conflicts do not silently adopt remote base. |
| Render/export | preview HTML/PDF, render and export routes, render-worker | Last successful preview retained on failure, retry pinned historical render, exact saved SHA export receipts. Latest export saves first and refuses mismatched revision receipt. |
| Permissions | existing session/brand authorization and editorial policy | Reused guards; added unrelated-brand edit regression. No new approval workflow. |
| History | `VersionPanel`, `DiffView`, restore API | Contextual history/compare, historical read-only selection, return latest preserves draft. Existing restore confirmation/append-only revision machinery reused; restore disabled with unsaved draft. |
| Comments/details | `CommentsPanel`, source frontmatter | Context panels reuse existing comments. Header/details track selected source instead of stale initial metadata. |
| Library | `LibraryView`, existing document metadata | Search/filter persistence and guarded new-document form. Existing PUT and `/edit` route reused. |

## State contracts

- Source text remains the authoring source of truth; pane selection must not rewrite it. Unsupported visual content stays intact and requires Source editing.
- Save state and preview state are independent. Preview success does not mean saved; save success does not imply a fresh render.
- Draft recovery uses browser-local storage. Failed save must neither clear draft nor enable a stale latest export.
- Save requests serialize; a response acknowledges submitted bytes, not edits typed afterward.
- Export identity is a concrete full commit SHA. DOCX rejects mutable/malformed `ref`; PDF and DOCX return `X-Docgent-Revision`. The client checks this receipt before downloading latest output.
- Historical preview selects saved content without replacing the current draft. Historical render failures remain errors even if an iframe load event fires.
- Feature switch: `DOCGENT_UNIFIED_WORKSPACE=1`. Leave unset to retain legacy routes. Rollback requires removing the flag/restarting the application; no data migration. Server-side revision safety fixes intentionally remain active. Library enhancements are additive rather than flag-isolated.

## Incremental tests and execution

Behavioral tests were introduced red, implementations made green and slices committed locally (see branch log). Coverage includes immutable DOCX export, PDF receipts, unchanged-save races, route flag/brand permissions, pane independence and responsiveness, source preservation, preview retry, failed-save recovery, concurrent keyboard saves, conflicts, historical draft preservation, comparisons, header metadata, library filters and creation.

Final executed commands:

```sh
npm test
npx tsc --noEmit -p apps/studio/tsconfig.json
npm exec --workspace @docgent/studio -- next build
npx playwright test apps/studio/test/workspace.browser.spec.mjs --reporter=line
node apps/render-worker/stage.mjs
.venv/bin/python apps/studio/test/render-fixtures.py
npx playwright test apps/studio/test/workspace-rendered.browser.spec.mjs --reporter=line
```

Results: unit/regression command exit 0 (final runner 180 passing, zero failing); TypeScript exit 0; production build exit 0; main Chromium suite 14 passing; real-render artifact browser suite 3 passing. Logs: `/tmp/docgent-unified-tests.log`, `/tmp/docgent-browser-final.log`, `/tmp/docgent-unified-build.log`, `/tmp/docgent-unified-render.log`.

The browser harness bundles actual React application components but intercepts API transport. It is not a live authenticated Next application test. Render fixtures call the actual Flask worker using its test client with real Pandoc/WeasyPrint, not mocked render responses. Nine outputs returned HTTP 200 across short/long/complex and HTML/PDF/DOCX. Fixtures and output checksums are recorded locally under `.qa/workspace/render-manifest.json`; artifacts and screenshots are intentionally ignored by git. Python checks PDF/DOCX signatures. Synthetic complex input includes a table, chart SVG, callout, pagebreak, formatted link and code. DOCX fixture intentionally excludes SVG assets; this is not proof of DOCX chart fidelity.

## Outstanding acceptance and release blockers

This is substantial implementation, not a claim that every proposal criterion is complete. Independent review and remaining acceptance work are required before enabling the flag:

1. Full authenticated Next application browser traversal was not exercised; component harness plus route tests are not equivalent. Browser Back/Forward unsaved-work confirmation, scroll-position return and restore lifecycle need explicit integrated acceptance tests.
2. Mobile screenshots reveal excessive control density and an apparently blank initial output viewport despite DOM visibility assertions. Investigate actual iframe paint/cover positioning; current screenshot evidence does not establish readable first-screen output. Desktop screenshot inspection likewise requires stronger body-page visual acceptance.
3. Restore reuses existing confirmation/append-only implementation, but this session did not exercise restore against a synthetic Git repository from the browser. Comments CRUD and exhaustive permission roles were not browser-tested.
4. Browser checks cover Chromium desktop/mobile dimensions and keyboard save; not a complete accessibility audit or Safari/Firefox coverage. Context panel combinations at intermediate widths need further minimum-size checks.
5. Render HTTP success and signatures do not establish semantic/pixel fidelity for every complex output. No Word application opening or DOCX chart-fidelity claim is made.
6. Additive library changes are not wholly rolled back by the workspace flag. Review desired rollout boundary before enabling.

No secrets or customer documents are included in the test artifacts. No deployment was attempted.
