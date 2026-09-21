# Account/workspace foundation — implementation contract

**Status:** parent accepted §3–5/A1 for the local policy slice; A1 implemented and locally verified (see §11). No runtime integration or launch approval.

**Inspected baseline:** `feat/self-service-accounts`, `7f298ea0bd5d5cce58ba66ca5a5438e6386ee521`. Working tree was clean at entry. Inspection used tracked application source and the supplied GTM document only. No private brand configuration, secret files, production documents, remote repository contents or deployment configuration were read. No external writes, migration, commit, push or deployment was performed.

**Commercial authority:** supplied `doc_f2839d268c92_Docgent-Go-to-Market-Plan.md`, revised 20 September 2026; citations below use its section/requirement identifiers. Production state is supplied context, not newly verified by this audit.

## 1. Recommendation and immediate boundary

Retain Next.js/Auth.js, Google OAuth, Git document history and the render worker. Introduce a **workspace authority distinct from visual brands**. Do not turn off the current sign-in allowlist or use `/api/admin/brands` as signup.

Use a small transactional account registry for the eventual public control plane, while retaining Git for existing document content. A managed relational database is warranted for the target product's unique identities, atomic provisioning, revocation and entitlement/usage reservations; this is not a reason to migrate documents or choose/install a provider now. No existing managed database or approved account-registry repository was established in inspected code. Provider/resource approval is a blocker for durable integration, not for the next pure-policy slice.

The existing GitStore can implement a constrained low-volume registry only in a **separate operator-only repository**, with explicit branch-pinned reads, CAS, unique-identity indexing, atomic transactions and privacy/retention agreement. It is not safe to drop registry JSON into an existing document or brands repository. That alternative requires more than calling `writeFile`; do not silently adopt it merely because Git is already available. See §4.

**Local coding slice (A1, now complete):** dependency-free account/workspace policy and contract tests with a synthetic two-workspace fixture; no new infrastructure, signup route, runtime flag, allowlist change or deployed authority. It provides executable acceptance of ownership/lifecycle decisions, not completed GTM-01 or real provisioning. The first durable vertical slice follows the resource gate in §9.

## 2. Repository evidence and consequences

Paths are relative to this repository. Line ranges refer to the baseline above.

| Evidence | Observed behavior | Consequence |
| --- | --- | --- |
| `apps/studio/src/auth.ts:57-100` | Google sign-in requires email matching at least one YAML brand; rejects explicitly false `email_verified`, but not absent verification. `allowedBrands` and admin status are stamped into JWTs; brands recompute only with a fresh profile. | No persistent user/subject registry. Require positively verified provider identity for new accounts. Membership removal is not live-session revocation today. Keep legacy behavior behind an explicit compatibility boundary while adding new authority. |
| `apps/studio/src/middleware.ts:20-50,129-154` | Generic path parsing assumes first page segment or third API segment is a brand; Node runtime, despite older Edge comments; excludes auth, health and OG routes. | New `/account`, `/workspace` or `/api/account/...` paths must not accidentally become brand checks. Use explicit route classification plus handler checks, not middleware alone. |
| `apps/studio/src/lib/agent-auth.ts:4-26` | Explicit Authorization header takes precedence; malformed/invalid bearer never falls back to ambient human cookie. Sessions require `allowedBrands`. | Preserve credential precedence and human/agent distinction. Current helper lacks operation, workspace, membership and entitlement context. |
| `apps/studio/src/lib/store.ts:120-122,218-278,333-391` | Brand record includes `repo` and access lists; disk config and stores cached in process. Remote config fallback only when disk brand missing. Studio uses `DOCGENT_GH_TOKEN` for stores across brands. | A brand currently combines style, tenant access and repo selection. Fresh persistent authority must not use these caches as revocation state. Do not infer token scope from its name. |
| `packages/git-store/src/documents.mjs:17-38,69-82,115-140` | Current documents use flat `documents/<slug>/doc.md`. Brand identifies repo; legacy nested paths are recognized in listings. Direct reads/writes use flat path. | Pointing unrelated workspace brands at one repo exposes/collides with the same flat namespace. Listing support for legacy nesting is not a workspace-prefix adapter. |
| `apps/studio/src/lib/store.ts:684-705`; `apps/studio/src/app/api/admin/brands/route.ts:37-52` | Admin creation writes local scaffold with name/access only; no repo, account, transaction or trial. Existing admin PUT writes local YAML (`store.ts:666-670`). | Not persistent self-service provisioning on Vercel; do not reuse as account creation. |
| `apps/studio/src/app/api/brand/[brand]/config/route.ts:24-108`; `apps/studio/src/lib/store.ts:523-569` | Any currently brand-authorized session/token can read and replace full brand YAML through a dedicated Git write token. No schema-level separation of visual fields from `repo`, `access`, identity. | Never expose this raw control document to a public customer. Changing styling must not alter ownership, repository routing, membership or authorization. Existing internal behavior is not a new-tenant permission model. |
| `packages/git-store/src/index.mjs:194-238,250-307` | Single-file blob-SHA CAS; multi-file commit uses branch head and non-force ref update. No cross-repository transaction, unique constraint or account-specific retry/reconciliation. | Useful primitive, not an account service. Race errors from upstream still need adapter normalization and bounded retries. |
| `packages/git-store/src/index.mjs:116-118,147-150` | `readFile`/`listDir` without explicit ref read provider default branch, not necessarily constructor branch. | Registry adapter must explicitly pin every read; constructor branch alone is insufficient. Never mistake a test branch read for isolated authority. |
| `apps/studio/scripts/clone-brands.mjs:3-10,21-43`; `apps/studio/next.config.mjs:23-32` | Studio build clones private brands and traces YAML into function bundles. | Per-customer access/provisioning must not require rebuilds or cloning account records into bundles. Do not run prebuild in a secrets-free audit. |
| `apps/render-worker/stage.mjs:39-50`; `apps/render-worker/server.py:212-221,501-511`; `.github/workflows/sync-brands-and-deploy.yml:19-33,78-96` | Worker image embeds brand configs; worker loads brand by filesystem ID. Brand changes can drive rebuild/deploy workflow. | Creating a database brand row does not make it renderable. Default renderer profile must be separated from workspace identity; custom brands need a reviewed runtime profile-delivery contract, not a deployment per signup. |
| `apps/studio/src/lib/render.ts:14-32`; `apps/render-worker/server.py:635-638` | Studio-to-worker uses shared service key, no customer identity/entitlement lookup. | Key stays server-only. Authorize before dispatch; future async jobs must carry scope and recheck at execution. Never hand worker key to customers. |
| `apps/studio/src/app/api/render/[brand]/[slug]/route.ts:38-72`; `apps/studio/src/lib/pdf-cache.ts:48-76,94-145` | GET can render on cache miss; memory default, optional gateway, best-effort puts; get maps errors and missing objects to null. | Read-only cannot simply permit all GETs. Existing output download needs retrieval-only path and distinguish missing/unavailable from permission denial. Durable output availability remains a separate launch blocker. |
| `apps/studio/src/app/api/preview/[brand]/[slug]/route.ts:54-55`; render route `:67-68` | Frontmatter brand can override render brand after route auth. | New workspace requests must resolve only an owned visual profile; frontmatter cannot select another tenant's private renderer configuration. |
| `apps/studio/src/lib/metadata.ts:30-57`; `apps/studio/src/app/[brand]/[slug]/page.tsx:33-37`; `apps/studio/src/app/api/og/[brand]/[slug]/route.tsx:24+` | Public metadata path reads selected document fields; OG excluded from middleware. | New private workspaces require generic unauthenticated metadata, including title/client/author and historical refs. Existing public-preview compatibility needs explicit legacy treatment. |
| `apps/studio/src/app/page.tsx:18-29`; `apps/studio/src/lib/store.ts:401-437` | Library reads all configured brands, then filters results. | New listing must authorize before fetching repositories; cannot extend this into scanning all customer data. |
| `packages/cli/src/docgent.mjs:83-144`; `docs/self-service-foundations.md:68-72` | Internal CLI can use direct repo credentials; hosted rewrite remains internal/operator-funded. | Direct Git is trusted operator access and bypasses app enforcement. New customer connections receive only revocable Docgent credentials; disable hosted generation for commercial workspaces while retaining agent-supplied revisions. |

Scoped absence evidence: tracked Studio/package source has no account/workspace registry implementation, SQL/ORM adapter, signup/trial lifecycle or Stripe/Paddle integration. Source term search only found descriptive uses of “membership” in existing brand auth. This does not establish that the operator owns no suitable external resources.

## 3. Minimal authority model

Proposed internal TypeScript names below are contracts, not existing exported APIs. All IDs are opaque server-generated identifiers, never client-selected paths, emails or repository names.

| Record | Minimum fields/invariants |
| --- | --- |
| `Account` | `id`, `status: active|suspended|closed`, creation time. Stable application principal, distinct from OAuth identity and commercial workspace. |
| `Identity` | `provider`, `providerSubject`, `accountId`, verified-email contact metadata. Unique `(provider, providerSubject)`; Google `sub` is authority, not email or domain. Email changes never silently relink accounts; no automatic linking by matching email. |
| `Workspace` | `id`, immutable owner account ID, `kind: commercial|internal`, provisioning state, creation time, trial timestamps, entitlement state, monotonically increasing authority revision. One owner/member for Trial/Solo. Prevent owner removal without explicit future transfer/closure flow. |
| `Membership` | `(workspaceId, accountId)` unique; initially `role: owner`, active/revoked state and revision. Model role explicitly without building Studio invitations/editors now. |
| `BrandProfile` | `id`, `workspaceId`, display name, safe visual configuration/version, renderer-profile reference. Up to three Trial/Solo profiles. No access list, repo selector or credential in writable visual config. |
| `StorageBinding` | `workspaceId`, storage adapter kind and server-owned locator/branch/namespace, binding version/status. Immutable through customer API. Existing brands may have several bindings inside one approved internal workspace; do not infer ownership grouping from email overlap. |
| `LegacyBrandBinding` | Explicit legacy brand ID → workspace/binding/profile mapping, migration state. No default catch-all mapping or automatic entitlement exemption. |
| `AgentCredential` | `id`, `workspaceId`, creator account ID, high-entropy token digest (never plaintext), allowed operations, optional narrowed brand IDs, created/expiry/revoked times. Raw secret shown only once over authenticated owner response. Revocation and owner suspension dominate scopes. |
| `ProvisioningOperation` | Unique account + operation kind/idempotency key, request fingerprint, reserved workspace ID, state, completed steps, safe error code/retry info. Never secrets or document contents. |

Document identity for commercial routing is `(workspaceId, documentId)`; its visual `brandProfileId` is an attribute, not its owner. Preserve existing `/brand/slug` URLs through explicit legacy resolution. New workspace URLs/API should use a separately classified namespace; exact route names can be settled in the adapter ticket. Do not rename/move existing documents to achieve this separation.

### Access invariants

1. Authenticate identity/credential, resolve target workspace from authoritative server mapping, check live account/membership/credential state, then operation entitlement, then applicable document validation and exact-SHA/CAS checks. Review/status labels are not editorial locks. Unknown state, unreadable authority or mixed bindings deny access; never fall back from commercial to legacy.
2. OAuth sign-in creates identity only through explicit controlled provisioning. New accounts require `provider === google`, nonempty subject, and `email_verified === true`. JWT may carry principal ID, not durable grants. A successful session is not workspace ownership.
3. Fresh authority is required on protected requests; do not cache positive authorization indefinitely. Initial implementation reads authority on each request. Requests beginning after a successful revocation commit must fail; in-flight operations already authorized may finish and must be disclosed/tested. Recheck before external mutation/worker dispatch; fully linearizable revocation against Git commits would need additional coordination and is not claimed.
4. Preserve explicit-header precedence: a bad/revoked token plus valid cookie remains denied. Agents with active credentials explicitly scoped to `review.complete` or `status.change` may perform those operations; they are not human-only. Agents cannot read account-level state, create/revoke peers, manage membership, change bindings or buy a plan. Owner-only credential management; CSRF/origin protection for cookie-authenticated mutations.
5. Exact-SHA status updates and stale-write handling remain mandatory for humans and agents. Review/status labels do not block editing or require human approval; workspace ownership, explicit agent operation scope, entitlement and CAS still apply.
6. No customer receives GitHub PATs, registry connection credentials, brands write token or renderer key. Customer operations cannot select arbitrary `repo`, `ref` namespace or filesystem path. Historical versions, diff, metadata, assets, thumbnails and cached outputs use the same ownership checks as current source.
7. Entitlement enforcement is operation-based, not HTTP method-based. Preview POST, HTML preview, thumbnail and render GET all count as new rendering when they execute the worker. Registry outages fail closed with a safe unavailable code, not false “missing account” or silent reprovisioning.
8. Brand edits accept only explicitly validated visual fields. Never round-trip raw legacy YAML through commercial APIs. Neutral sample/profile contains no copied internal brand assets or private metadata.
9. All commercial reads are private/no-store unless explicitly serving the independent public sample. Nonmembers receive non-enumerating not-found/denied behavior; anonymous previews reveal no customer metadata.
10. `internal` is an operator-assigned workspace policy, not an email-domain rule or session-supplied flag. It may preserve current hosted rewrite and no-trial behavior, but does not confer cross-workspace access.
11. A ready workspace must retain at least one owned visual profile, including internal workspaces. Deny deletion of its final profile with the safe `final_profile` code; do not relax snapshot validation to accept empty ready workspaces. The future mutation adapter must atomically check and reserve the final-profile invariant with the deletion (transaction or revision/CAS with fresh re-evaluation). Concurrent deletions that both observe two profiles must not both commit. This pure-policy precheck is not an atomic reservation or store enforcement.

## 4. Persistence decision and document storage constraints

### Existing Git registry: conditionally possible, not approved

A single private registry snapshot updated with blob-SHA CAS could atomically hold identities, owners, memberships and provisioning reservations for a small controlled pilot. A multi-file alternative requires `commitFiles` with an explicit expected branch head so the identity index and workspace records move together. Resolve a concrete commit before loading a multi-record snapshot. On timeout-after-write, reread durable operation identity before retrying; retry CAS conflicts only after validating all invariants on fresh state. Do not blindly overwrite or increment trial dates.

This would require a dedicated control-plane repository, a service identity with contents read/write only there, explicitly restricted operators, no customer/agent Git access, no brand deployment dispatch and a retention policy accepting identity/token-digest history. Ordinary Git deletion does not erase prior commits. GitStore presently has no uniqueness transaction facade, revocation freshness strategy, bounded timeout/retry envelope, account schema validation, or account-safe error mapping. `readFile` needs explicit branch/ref. Single-file serialization is a contention point; multi-file transactions still share a branch and GitHub API/rate availability. Quota reservations plus external document writes are a saga, not a Git transaction.

**Rejected shortcuts:** existing organization document repo, shared brand-config repo, per-account environment variables, disk files, PDF cache, or user-controlled YAML as authorization database. Existing repo collaborators, build workers and brand editing paths have the wrong trust/retention boundaries. No permission inventory was fetched; do not assume an organization name establishes permission separation.

### Recommended public control plane

Use one approved managed relational database with unique keys and transactions for account/workspace/membership/credential/operation records. Needed semantics: unique provider subject; one initial owned commercial workspace per account; atomic owner/workspace/trial/default-profile record; conditional revision updates; durable operation dedupe; time-based entitlement evaluation; atomic usage reservation in later slices. No new general job platform, ORM requirement or event bus is implied. An injectable account-store interface can keep provider choice out of policy code. Database schema migrations start additive and must be separately approved for the chosen environment.

Operator must identify an existing suitable project or approve a new resource, region, cost/backup settings and least-privilege runtime/migration access. Do not guess Supabase/Neon/D1/etc. from Vercel/Fly presence. Backups and deletion guarantees must be verified for the selected service; “managed” is not evidence.

### Git document storage remains a separate decision

- Preserve all existing per-brand repositories and histories, including external organization ownership. No content transfer or repermissioning without the relevant owner's approval.
- Safest reuse candidate for new commercial workspaces is one service-owned private repository per workspace, accessed only through Docgent. It avoids current flat-path cross-workspace collisions but requires approved organization, provisioning rights, repo lifecycle/cost/limits and failure recovery. Current token names do not prove creation permission. Customer ownership must not require customer GitHub setup.
- A shared service repo could work only after implementing a strict workspace-root adapter across listing, reads, writes, history, diff, assets and cache keys; history/metadata must never enumerate other prefixes. It is not safe with current DocumentStore. Do not choose this to avoid asking about repository provisioning rights.
- Several visual profiles in a workspace must share document ownership independently of renderer profile. Do not create three account authorities or three trial counters for three brands.

**Decision gate:** choose/approve document backing topology before the first workspace becomes usable; an account registry alone does not solve document isolation. Provider-specific adapters and repository creation are explicitly outside the immediate slice.

## 5. Provisioning and lifecycle contract

### Idempotent, controlled provisioning

Public signup stays closed. First integration is operator-invited/internal test accounts only, using real OAuth identity and the same provisioning service intended for eventual public use; no alternate permanent public bypass.

1. Verify OAuth subject; load or uniquely create Account/Identity. An existing subject resumes its existing operation/workspace even when callback or client idempotency keys differ. Do not grant multiple trials via retry.
2. Atomically reserve operation and stable workspace ID in `provisioning` with one owner membership. Timestamp reservation separately from workspace creation/trial start. No usable workspace or trial event yet.
3. Provision or verify backing storage with a stable operation marker and server-generated locator; verify privacy/access. Resume by marker after interruption. Never adopt an arbitrary existing repo/name collision or delete unknown resources on failure.
4. Prepare owned neutral default profile and verify the renderer can use it without redeploying per user. New runtime brand configuration must be constrained/sandboxed; raw CSS/template execution is not an implied customer capability.
5. Atomically finalize `ready`, set immutable workspace `createdAt`/`trialStartedAt`, `trialEndsAt`, owner and entitlement revision. For this contract “workspace created” means the usable workspace commit; earlier reservation is provisioning only. This implements GTM §3 trial-at-workspace-creation, not first render or OAuth login. If product wants reservation-time trial instead, resolve before integration, not implicitly in a callback.
6. Read back exact workspace/operation before returning success. Emit a deduplicated `trial_started` event keyed to workspace only after durable creation, without source text or credentials. Show expiry date and safe provisioning/retry status.

Retries return the same identity/workspace/trial timestamps. Same explicit key with different request fingerprint returns conflict. Different keys for one subject cannot create extra initial workspaces. Timeout after remote success reconciles; missing registry is not a signal to create another workspace. Provisioning failure is recoverable and does not enable document access. Deleting orphan infrastructure is a separate operator-reviewed action, not automatic rollback.

### Entitlements and state transitions

Use UTC instants and injected clock. Proposed implementation measures day durations as elapsed 24-hour periods; display local expiry date. Access is evaluated from persisted timestamps on every request, so a missed scheduled task cannot extend a trial.

| State | Entry/exit | Allowed operations |
| --- | --- | --- |
| `provisioning` / `provisioning_failed` | Reserved operation; recover same ID or mark safe failure | Owner can inspect safe setup status/retry; no content operations. |
| `trial_active` | Workspace becomes ready; ends at `trialStartedAt + 14 days` | One editor, one workspace, up to three brands and three customer-created documents; normal create/revise/review/export and scoped agent access. No card and no hosted AI generation. |
| `paid_active` (later billing slice) | Verified deduplicated purchase begins term immediately, including during trial | Solo entitlements; no trial reset. Cancellation only schedules nonrenewal; active until paid-through. No payment route in this phase. |
| `read_only` | At exactly trial expiry or paid-through expiry; ends 30 days later | Authorized source/history reads, available source + safe brand config export, retrieval of existing outputs, billing/account access and credential revocation. No creation, edits, agent writes, new rendering, review/status changes or visual-config mutation. |
| `retention_hold` (implementation safety state) | At exactly read-only deadline, pending approved notification/deletion policy | Deny normal content and render operations; permit safe account/support state and revocation. Preserve data until explicitly authorized retention/deletion machinery exists. Not a promise of indefinite product access. |
| `suspended` / `closed` | Explicit operator/account lifecycle action; dominates dates | Deny content/agent access; narrowly scoped account/support recovery only. No implicit deletion. |
| `internal` entitlement | Explicit operator mapping only | Existing internal operation policy without commercial timers; still enforce workspace ownership, operation scope and exact-SHA/CAS checks. |

Do not automatically delete at the read-only deadline in this phase. GTM requires prior notice and honest backup-retention disclosure; deletion from Git HEAD is not erasure. Payment failures/grace, refund and downgrade rules remain blockers for billing, not defaults to invent here.

Trial/brand/editor/document allowances are fixed GTM packaging (§3); storage/render figures remain provisional and must not be published as enforced until measured and metered. Customer-created document count is lifetime creation within a trial, not current count (proposal prevents delete/recreate bypass); sample excluded only if server-marked, never client-declared. Confirm this counting interpretation in parent review. Later create operations require atomic reservation plus reconciliation to avoid concurrent over-allocation; a list-count precheck is insufficient.

## 6. Enforcement integration map

| Surface | Required new-workspace handling |
| --- | --- |
| Auth callback/session | Preserve legacy allowlist until new path is enabled for selected identities; stable provider subject and durable Account ID; no public signup merely by accepting more emails. |
| Middleware | Explicit legacy/new route classification; do not reject new top-level paths as brand IDs; handler remains authority. Preserve proxy/OAuth behavior. |
| `agent-auth.ts` | Resolve typed actor and authoritative workspace membership/token, then operation policy; legacy resolver only for explicitly legacy targets. Keep explicit credential precedence. |
| Docs/doc/diff/restore/rewrite accept/status APIs | Workspace binding before store reads; exact-SHA/CAS checks remain; no human-only review/status or editorial-lock gate; no hosted rewrite for commercial workspaces. Quota reservation only for new docs, not each edit. |
| Library/document/edit pages | Fetch only authorized workspace stores; no data read before scope check. UI reasons for entitlement expiry or scope denial; server still enforces. |
| Brand config/assets/admin APIs | Keep deployment admin distinct from workspace owner; commercial visual schema only, no raw YAML or runtime secrets. Old admin endpoint not reused for customer management. |
| Render/preview HTML/PDF/thumbnail | Owned profile check; entitlement at execution; read-only cached-download-only path cannot silently invoke worker. New cache keys include workspace/document/profile version identity. Preserve legacy keys for existing documents. |
| Metadata/OG/sign-in cover | Generic for anonymous new-private targets; no customer store read; separate intentional public sample. |
| Connection check | Add safe workspace scope/credential state and entitlement denial codes only once implemented; never advertise billing/archive/provisioning readiness from config presence. |
| Worker/direct Git/CLI | Service-only paths remain privileged internal tools. Do not expose their credentials as supported public onboarding. Verify no alternate customer write/render bypass before enabling commercial access. |

## 7. Non-destructive compatibility, failure and rollback

- Begin with additive unused policy/types/tests. No legacy records created by inference, no brand files rewritten, no repository moves, no token rotation and no build changes.
- Before real migration, operator supplies an approved mapping of legacy brands/repositories to owners/internal workspaces. Validate a dry-run report of IDs/mapping conflicts without loading document contents. Preserve original URLs, repo branches, source SHAs and PDF cache lookup behavior.
- Migrate one explicitly selected internal test workspace; unmapped legacy paths retain existing policy. A target once classified commercial never falls back to a legacy token/allowlist when registry unavailable or a rollout switch is disabled.
- Failure codes distinguish `authority_unavailable`, `provisioning_pending`, `provisioning_failed`, `workspace_forbidden`, `credential_revoked`, `trial_expired`, `readonly_expired`, `storage_unavailable`. Return safe diagnostic IDs, not upstream token/repo details or YAML.
- Separate inability to load authority from absence; return retryable 503 for outage, not a new account/trial. CAS conflict preserves current data; corrupt mapping denies access.
- Roll back initial pure policy by removing unused code. For a later integrated slice, disable new admissions/mutations while keeping already-created accounts under the enforcing build or maintenance denial. Never roll back to a build that bypasses revocation/entitlements for those accounts. Retain records, orphan markers and revocations for reconciliation; no force reset or destructive compensating migration.
- Existing-output durability is not repaired by the account phase. Current cache miss regeneration violates read-only rules if allowed; deny new rendering and report unavailable existing output honestly. Durable artifact/export work must land before promising GTM expiry/export behavior publicly.

## 8. Decisions: code/GTM versus operator

### Resolved from code/GTM (parent can implement without reopening business strategy)

- Workspace ownership cannot remain synonymous with brand; current YAML repo/access and flat storage prove the boundary.
- Retain framework, OAuth provider, Git document history and renderer; no evidence supports a framework rewrite.
- Trial is 14 days, no card, one workspace/editor, three visual brands, three customer-created documents; expiry followed by 30 days read-only/export. Solo first; no Studio purchase/invitation build now.
- Agent credentials must be workspace-scoped, independently revocable; review/status operations require explicit credential scope and are not human-only. Account, credential and billing management remain human-owner-only. OAuth email allowlist is internal compatibility, not customer ownership.
- Current disk admin scaffold is not provisioning; build-time brand loading must not become account persistence.
- Existing direct Git and worker credentials are internal operator capabilities, not commercial customer integration credentials.

### Implementation proposals requiring parent architecture review, not operator spending

- Transactional managed registry recommendation; Git retained for content. If Git registry chosen, require all controls in §4 rather than deploying an improvised snapshot.
- Subject-based identity, immutable ownership IDs, explicit legacy mappings, policy-first next slice; UTC elapsed-day boundaries; trial starts at durable usable workspace creation.
- Lifetime customer-created trial document counting and excluded server-owned sample; closed retention hold rather than invented automatic deletion.
- Revocation freshness guarantee covers requests beginning after commit; no claim to cancel an already-running Git write/render.

### Exact operator/resource blockers for durable integration

| Blocker | Owner/action needed | What is *not* requested now |
| --- | --- | --- |
| No inspected persistent registry service | Operator identifies existing approved managed project/resource and region or approves a new one; confirm runtime transaction support, least-privilege access, backup/retention/cost. Alternatively approve a dedicated isolated registry repo and Git-specific tradeoffs. | No credentials in chat; no provider provisioning or database migration in this audit. |
| New workspace document backing unapproved | Operator approves service-owned Git organization and per-workspace repo lifecycle/creation permission, or parent designs/tests scoped shared storage then operator approves it. Verify access with safe metadata/permission probes in a later authorized step. | No use of an existing internal org repo by assumption; no transfer of internal documents. |
| Legacy ownership not inferable safely | Operator supplies exact brand/repo → internal workspace owner mapping and confirms legitimate data stewardship. Separate legal/IP agreements remain outside technical finding. | No reading private brand configs or production documents to guess consent. |
| Neutral renderer profile not established | Implementation owner provides sanitized default profile and verifies deploy-independent customer profile lookup/delivery contract, including worker isolation and assets. | No copying private brands; no deploy-per-signup workflow. |
| Deletion/notification/backup policy incomplete | Operator approves notices, retention and deletion responsibilities before launch; implementation owner inventories stores/history/caches in a separately authorized phase. | No destructive migration or silent purge. |
| Durable existing outputs unavailable as verified guarantee | Separate reviewed archive/export slice with cache-miss and restart tests before public expiry promise. | Do not revive deferred archive implementation here. |

Google OAuth client availability to strangers, consent configuration and callback/proxy behavior must be verified before opening signup; this audit did not read provider settings. Existing login code is not evidence of public OAuth eligibility. Billing provider/failed-payment rules and charges are deferred, not blockers for local policy tests.

## 9. Testable tickets and gates

| Ticket / owner | Scope and dependency | Acceptance / GTM mapping |
| --- | --- | --- |
| **A1 — workspace policy contract (next; implementation owner)** | After parent review, add `apps/studio/src/lib/workspace-policy.ts` plus `apps/studio/test/workspace-policy.test.mjs`, using existing `test/load-module.mjs`. Pure types/functions only; injected clock and authority snapshot, no imports of auth/store/fs/network. Model actor, ownership, operation, lifecycle and safe denial reasons. No runtime call sites. | Table tests: two unrelated workspaces denied across source/history/output/profile operations; spoofed workspace/profile/internal kind cannot grant authority; revoked credential/membership/account overrides active trial; scoped agent review/status allowed and denied without operation scope; agent account/credential/billing management denied; exact trial and read-only boundaries; legacy-internal explicit fixture has no commercial expiry; missing/corrupt timestamps fail closed; read-only download allowed but render denied; renderer limit distinct from editing permission. Existing `npm test` must pass. GTM-01/02/08 foundations only, not end-to-end completion. |
| **A2 — account-store conformance and durable controlled provisioning (first real vertical slice)** | Depends on operator registry resource + parent architecture choice. Introduce small injectable store/service and additive schema; controlled test identities only, no public signup. Provision identity, operation, workspace owner and trial atomically/resumably; synthetic storage/profile adapters first, then approved scratch backing. | Real approved nonproduction persistence survives independent instances/restart; concurrent same-subject callbacks yield one workspace; different keys cannot reset trial; key mismatch conflicts; timeout after commit reconciles; failed backing creation never grants access; registry outage denies without duplicate provisioning; exact target readback. No production documents. GTM-01/08/10 partial. |
| **A3 — one guarded workspace read with live authority** | Depends A1/A2 and approved legacy test mapping. Add controlled owner-only workspace summary endpoint showing safe trial expiry/readiness; explicit middleware classification; policy in handler. No content/billing/admin secrets exposed. | Existing internal sign-in unchanged; uninvited identities rejected; stale JWT/revoked membership denied next request; anonymous/malformed credential denied; second account cannot enumerate first. Browser + handler tests. This is first useful authenticated account UI/API slice, still not public GTM-01. |
| **A4 — isolated document and neutral-renderer binding** | Depends document storage choice and neutral profile resource; no arbitrary brand YAML exposure. Integrate owned profile lookup across doc/read/history/asset/cache/metadata and worker dispatch. | Two accounts with same slug/profile name cannot collide; private metadata generic; disallowed frontmatter profile rejected; all data reads scoped before I/O; interrupted repo/profile provisioning resumes without duplicate resources; no app/worker deploy per workspace. GTM-01/05/08. |
| **A5 — credentials, expiry and quota enforcement across routes** | Depends A3/A4; add owner issue/revoke endpoint/UI, digest-only storage, operation guards and transactional trial-create reservations. Keep hosted AI internal. | Fresh supported connection creates/revises; revocation rejects next write without logout/deploy; credentials never inherit cookie authority; raw config/control fields denied; every render entry denies expired execution; concurrent fourth trial document prevented; cache-only downloads do not render. GTM-02/07/08. |
| **A6 — export/durability and lifecycle launch gate** | Separate reviewed artifact work, source/profile export and approved notices/retention; billing later. | Existing outputs retrieved across instances without rendering during 30 days; source + visual configuration export usable; no secrets included; post-window hold/deletion matches disclosure; no irreversible action without approval. Public signup stays closed until complete end-to-end isolated flow passes. GTM-04/08/09/11. |

No calendar estimate is claimed. A1 is executable immediately after parent review without operator resources. A2 is deliberately blocked rather than fabricated with a “durable” in-memory/file adapter. Test fakes demonstrate policy/service semantics only; they are never acceptance evidence of production persistence.

## 10. Original documentation-audit verification (before A1)

This phase produces documentation only. Source evidence and local Git baseline were inspected; no application tests/build, OAuth, worker, storage service or live provisioning were exercised by this audit. Automated reference validation found 28 existing referenced repository paths, zero missing references (excluding the explicitly proposed new policy/test files), and all required contract sections. `git diff --check` passed; because this document is untracked, a separate `git diff --no-index --check /dev/null docs/self-service-accounts-contract.md` produced no whitespace diagnostics (exit 1 denotes the new-file difference). `git status --short` showed only this untracked contract. Parent's next review should accept/revise §3–5 and A1, then request only the operator resources necessary for A2 rather than opening signup or deploying speculative infrastructure.

## 11. A1 implementation and execution evidence

Implemented `apps/studio/src/lib/workspace-policy.ts` and `apps/studio/test/workspace-policy.test.mjs` using the existing `load-module.mjs` runner. The policy has **zero imports and zero production call sites**. Existing tracked application files remain unchanged; this contract was already intentionally untracked at entry. No commit, push, deployment, signup, configuration, credential or external API write was performed.

### Executable scope

- Typed server authority snapshot plus injected millisecond clock, sampled once per decision. `authoritative: true` is a required adapter assertion, **not an unforgeable security primitive**. The future adapter must authenticate the actor, preserve invalid-explicit-token precedence over cookies, resolve resource ownership before I/O, load fresh consistent authority and recheck before mutation/worker dispatch. This module cannot discover stale snapshots or revoke in-flight work.
- Matching account, workspace owner, owner membership, credential creator/workspace, operation scope and optional narrowed owned-profile scope. Complete profile inventory rejects mixed ownership and duplicate IDs. No email/domain or request-supplied internal flag grants authority. A narrowed agent cannot request a workspace-wide read without a profile filter. Membership/binding management is unsupported and denied, including for owners; account reads, credential management and billing remain human-owner-only. Review/status completion is allowed for agents with explicit operation scope, subject to live authority, profile scope and entitlement.
- Explicit account/workspace suspension/closure, membership revocation and credential revocation/expiry dominate content permission. Only an otherwise matching human owner with active membership can inspect safe account state or revoke credentials during suspension/closure. Provisioning never permits content; safe owner account status is available before creation/trial timestamps exist. Provisioning retries themselves remain A2, not an implemented operation.
- Ready commercial workspaces validate creation equals trial start and trial end equals exactly 14 elapsed days later. At expiry only reads/exports/existing-output retrieval and owner account/billing/revocation access remain; at exactly another 30 days normal content is denied without deleting anything. Explicit internal authority has no commercial timers but retains all ownership checks. Minimal paid modeling accepts only trusted `active` plus valid `paidThrough`; it replaces the trial deadline without resetting timestamps. Cancellation scheduling, purchase verification, failure/grace, refunds and downgrades are **not implemented**; unknown billing states deny, not guessed transitions.
- Trial lifetime document creation precheck below three; Trial/Solo profile creation precheck below three. Server-owned samples are excluded upstream from the trusted lifetime counter, never by a caller `sample` flag. A successful quota-limited decision carries a required `trial_document`, `brand` or `render` reservation label: it is **not** an actual reservation. Atomic check-and-reserve and reconciliation remain mandatory before real execution. Render exhaustion denies new rendering only, preserving editing and existing output retrieval. Numeric render allowances, reset/retry accounting and all storage-limit measurement/enforcement semantics remain unresolved/deferred; no invented storage denial, eviction or destructive action exists here.
- Profile edit/export allowance refers only to separately validated visual fields, never secrets or raw legacy YAML. `output.download` is strictly retrieval-only and does not prove an artifact exists; a miss must not invoke `render.new`. Exact-SHA status updates and CAS remain separate mandatory checks, not overridden by policy allowance. Review/status labels are not editorial locks and do not require human approval. Policy results contain only detached booleans, enumerated safe denial codes or reservation labels; tests freeze inputs and mutate outputs to check isolation.

### Historical test-first and final verification (before review/status alignment)

Vertical RED→GREEN cycles were executed for unavailable authority, ownership, live revocation/provisioning, agent privileges, exact lifecycle boundaries, internal scope, paid-through, quotas/render limits, corrupt-input validation, and safe recovery. The initial RED was the absent module; subsequent RED runs produced actual assertion failures (and missing-state failures before defensive validation). Each implementation slice was followed by the full regression suite. Expanded cross-workspace and mutation/privacy regression tables exercise the same real module, not a mocked policy.

Review follow-up reproduced an allowed final-profile deletion that would leave a ready workspace invalid and deny even recovery operations. A transition regression was written and run before the fix: `node --test --test-name-pattern='profile deletion preserves' apps/studio/test/workspace-policy.test.mjs` failed with actual `{ allowed: true }` versus expected `{ allowed: false, code: 'final_profile' }` (`trial/human: final profile`, exit 1). The minimal guard then passed the same test (exit 0). The regression exercises two-to-one deletion, denial of one-to-zero, and continued owner create/read/account/revocation/billing access across trial, paid and internal workspaces with human and agent actors; empty ready snapshots still fail closed. Existing broad allowance fixtures now use two profiles so deletion eligibility does not mask their scope/lifecycle assertions.

Additional characterization tables exercise internal agents with commercial brand/document usage above caps and exhausted render availability, long after commercial expiry. Internal allowances carry no commercial reservation labels, while credential revocation/expiry, membership revocation, account/workspace status, operation/profile/workspace/actor scope and the four human-only account/credential/billing operations still deny as appropriate; explicitly scoped review/status operations are allowed. These existing behaviors required no production changes. No live authentication, revocation store or concurrent mutation was exercised. The final-profile atomic reservation requirement in §3 remains a future adapter obligation.

Final commands and observed results after the review fix:

| Command | Result |
| --- | --- |
| `node --test apps/studio/test/workspace-policy.test.mjs` | **86 tests passed**, zero failed/skipped/todo. |
| `npm test` | **167 tests passed**, zero failed/skipped/todo. |
| `npm exec --workspace apps/studio -- next build` | Exit 0; Next.js 15.5.25 compiled successfully, lint/type checks passed, **7/7 static pages** generated, build traces completed. Direct invocation intentionally avoids the private-brand-cloning prebuild script. |
| `git diff --check` plus `git diff --no-index --check /dev/null <file>` for each of the three untracked deliverables | No whitespace diagnostics. New-file comparisons return exit 1 for differences, not whitespace errors. |

The review RED log is `/tmp/docgent-a1-transition-red.log`; final test/build logs are `/tmp/docgent-a1-transition-policy.log`, `/tmp/docgent-a1-transition-full.log` and `/tmp/docgent-a1-transition-build.log` (local only, not repository artifacts or durable CI evidence). These tests and build establish local pure-policy behavior only. No OAuth, public signup, persistent registry, live revocation, worker enforcement, storage isolation, billing, durable output delivery, concurrent final-profile preservation or concurrent quota enforcement has been integrated or exercised. A2 resource gates and the later launch gates are unchanged.
