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
- Feature switch: `DOCGENT_UNIFIED_WORKSPACE=1`. Leave unset to retain legacy routes. Rollback requires removing the flag/restarting the application; no data migration. Server-side revision safety fixes intentionally remain active. The library filters, return-context persistence and new-document UI are flag-gated; integrated flag-off traversal verifies their absence as well as legacy reader/editor routing.

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

## Acceptance closure follow-up

Application changes and integrated fixture committed in `e973b60`; subsequent evidence includes the real creation/export test. All writes remain local, with no push/merge/deploy.

| Gap | Implemented and exercised |
|---|---|
| Blank initial preview | The Chromium test browser reports `navigator.pdfViewerEnabled === false`: a successful PDF HTTP response cannot paint a native viewer that is absent. Unified current-document reading now falls back to sandboxed, read-only worker HTML. Unsupported historical inline PDF displays an explicit pinned download instead of a blank iframe. Native PDF remains used where supported. Cover-in-viewport assertions precede screenshots. |
| Preview transition crash | Real Next traversal exposed `injectEditCursor` appending to a null iframe head while switching from PDF to Visual. Both cursor and zoom injection wait for a real head/body; load listeners retry once the document exists. |
| Mobile density | Secondary document tools use a horizontally scrollable toolbar; title/save and pane switching stay outside it. Formatting controls are hidden while the mobile output pane is selected. Header height is asserted below 250px at 390×844. |
| Unsaved navigation | The Navigation API cancels same-document traversal before Next receives popstate. Real Next Back and Forward dismissals retain editor bytes; native reload cancellation is exercised separately. No history sentinels or mutations of Next's private router state. |
| Library return context | Documents returns to the stored, allowlisted bucket URL. Search/filter restoration survives real Next navigation. Scroll is captured on link activation and subsequent Next scroll-reset events are ignored until unmount; previously the reset overwrote the saved position. |
| Restore | Browser requests hit the actual restore route and DocumentStore backed by an isolated local Git transport. Restore appends a new commit, advances version, retains provenance, removes the later body, disables with dirty work, and retains a pending recoverable draft across the restore reload. Recovery against the new base surfaces a conflict rather than silently overwriting. |
| Drawers | History/Details/Comments focus the panel, Escape closes and returns focus, overlay-width keyboard handling keeps Tab within the panel. Context panels overlay rather than shrinking source/output below minimum widths at intermediate viewports. Read-only output is keyboard-focusable. |
| Comments/permissions | Actual comment add and resolve pass through guarded save into Git; historical comment views have no add/resolve controls and Save is disabled. Unauthenticated writes return 401; a signed test session for an unrelated brand cannot mutate the document. |
| Flag rollback | An independently started flag-off Next fixture verifies no unified library filters/create button, legacy reader, and legacy editor. No production auth/configuration code was relaxed. |
| Creation/export | Real New document → guarded PUT → unified edit. Actual local Pandoc DOCX downloads are checked for ZIP signature and the export URL/header commit is checked against the synthetic Git HEAD. |

### Integrated harness boundary

`apps/studio/test/next-fixture.mjs` copies the real Next application into ignored `.qa/next-*`, replacing **only the store transport module in that copy** with `local-git-store.fixture.mjs`. It retains the real DocumentStore, routes, middleware, Auth.js session decoding, validation, components and local Flask/Pandoc/WeasyPrint worker. No Playwright API interception is used by `workspace-next.browser.spec.mjs`. The adapter refuses production mode and paths outside the isolated test root; application code never imports it.

Sessions are explicitly synthetic Auth.js JWT fixtures, signed using an ephemeral random secret supplied only to those child processes. This is **not** a Google OAuth login or a claim of production authentication. Provider credentials are not inherited, persisted or required; subprocess environment is allowlisted. Git history and artifacts contain only synthetic documents. Fixture servers are stopped after tests; logs/Git/artifacts remain under ignored `.qa/next-*` for inspection.

### Final executed verification

- `npm test`: exit 0; final runner **180 passed, 0 failed** (not an aggregate across workspaces). `/tmp/docgent-gap-tests.log`.
- `npx tsc --noEmit -p apps/studio/tsconfig.json`: exit 0.
- `npm exec --workspace @docgent/studio -- next build`: exit 0. `/tmp/docgent-gap-build.log`.
- All four workspace Playwright files together: **27 passed**, including **8 real Next integration tests**, **2 focused acceptance tests**, **14 component transport tests**, and **3 real-render artifact tests**. `/tmp/docgent-gap-browser.log`.
- Screenshots inspected: `.qa/workspace/screenshots/next-initial-desktop.png`, `next-split-desktop.png`, `next-output-mobile.png`, plus `complex-desktop-body.png` and `complex-mobile-body.png`. The initial cover now visibly paints; the mobile output is readable rather than an empty viewport. Short/long/complex suites also record separate cover and body captures.

## Remaining release/compatibility limits

1. Real Google OAuth and a deployed customer-backed session were not exercised. Local integration uses explicitly seeded sessions and synthetic Git, not production credentials. Production auth and provider configuration are untouched.
2. Same-document navigation confirmation depends on the browser Navigation API. Browsers without it retain native cross-document/reload warnings and draft recovery, but same-document traversal prompting is not established there. Only Chromium was exercised; Safari/Firefox and a complete assistive-technology audit remain release checks.
3. Native embedded PDF paint is not tested in this headless browser because its PDF viewer capability is absent. The tested current-document fallback is real worker HTML, not PDF pagination. Historical unsupported-PDF fallback provides the exact rendered revision download explicitly.
4. The complex screenshots establish readable body/table/callout content, not exhaustive chart or DOCX visual fidelity. No Word-application opening or DOCX chart-fidelity claim is made; the existing SVG-to-DOCX fallback remains unchanged.
5. Independent review remains required before release; this document does not substitute local fixture coverage for that review.

No secrets or customer documents are included in the test artifacts. No deployment was attempted.

## Independent-review corrections (baseline `bbed52f`)

This follow-up is correctness/safety hardening of the unified workspace, **not acceptance of the broader UX redesign**. End-to-end evaluation against the original disjointed-workflow problems remains outstanding.

Behavioral regressions were observed failing before their fixes:
- Preview/historical outline mutation controls were enabled; shared current-capability guards now protect mutation paths, rewrite entry, saving and recovery while leaving navigation available.
- Pending proposals survived read-only transitions. They are now invalidated. Acceptance already sent to the server continues to be observed: a late successful commit refreshes history and explicitly marks the retained local draft conflicted instead of silently calling it saved or replacing it.
- History remained at the page-load revision after saving. Save and accepted-rewrite outcomes refresh server history; Compare uses the acknowledged immutable revision and discards comparisons after selection changes.
- Recovery crossed account boundaries. Draft keys now use an opaque hash of provider plus stable provider account ID. Auth callback tests cover different per-login `sub` values, token refresh, different accounts and legacy tokens without stable identity. Session change/logout cleanup removes other identities' drafts and unmounts private editing buffers. Legacy tokens without the new claim expose no recovery owner until fresh authentication.
- Without the Navigation API, dirty Back/Forward did not prompt. The tested fallback indexes application History API entries while preserving Next's opaque state and reverses cancelled traversal. Entries predating installation still rely on native cross-document warnings and recovery; real Safari/Firefox validation remains outstanding.
- Real Next regression runs exposed library filters accepting input before hydration/restoration. Unified filters remain disabled until restored. SSR/no-JavaScript and real return-context tests exercise this boundary.

The navigation/restore fixture now uses a genuinely invalid fenced block (`::: unknownfixture`) to hold a dirty draft; the previous two-colon text did not prevent autosave and made shared Git tests timing-dependent.

Final combined execution (separate logs, no overlapping writers):
- `npm test`: exit 0, final runner **186 passed, 0 failed** (not a workspace aggregate). `/tmp/docgent-final-regression.log`.
- `npx tsc --noEmit -p apps/studio/tsconfig.json`: exit 0.
- `npm exec --workspace @docgent/studio -- next build`: exit 0. `/tmp/docgent-final-build.log`.
- `npx playwright test apps/studio/test/workspace*.browser.spec.mjs --reporter=line`: **39 passed**, including real Next/synthetic Git/real renderer integration. `/tmp/docgent-final-browser.log`.
- Real rendering fixtures were regenerated using `node apps/render-worker/stage.mjs` and `.venv/bin/python apps/studio/test/render-fixtures.py`, both exit 0. `/tmp/docgent-review-render.log`.

Two independent static reviews differed: one reported no blockers; another identified the per-login identity and interrupted acceptance problems, both subsequently reproduced and fixed. Codex CLI and Claude CLI review attempts failed due to a missing executable and expired OAuth respectively; neither supplied a review verdict. No real Google OAuth login, customer-backed session, push, merge or deployment was performed.
