# Free-flowing editing

Review is optional. Git history, exact-version preconditions and brand authorization
protect collaboration; lifecycle labels do not lock documents.

## Contract

- Brand-authorized sessions and bearer agents can create, edit, accept rewrite
  proposals, restore, delete and change status. Explicit invalid credentials never
  inherit authority from an ambient session. Cross-brand tokens remain denied.
- Existing PUT, rewrite accept, restore and status POST require the exact blob SHA
  read by the caller as `baseSha`. Missing/malformed values return 428 and stale
  values return 409. Re-read and reconcile rather than silently replacing the SHA.
- DELETE requires that same full blob SHA in `If-Match`. Creation omits `baseSha`.
- Valid status vocabulary remains `draft`, `review`, `approved`, `released`,
  `superseded`. Creation and PUT may set a valid status; status POST permits any
  valid destination. `GET /status` currently returns common transitions as hints,
  not an exhaustive permission list despite the legacy field name `allowed`.
- Vocabulary validation still applies to document writes and restores.
- Accept attributes the commit to the authenticated human or agent and records
  rewrite provenance. Restore writes forward as a new commit; history is never
  rewritten. The existing version bump uses bounded historical discovery.
- Studio Edit and Restore stay available at every lifecycle status. Historical
  views still require loading current source before a version-bound mutation.
- Connection diagnostics report `edit`, `acceptRewrite`, `restore`, `changeStatus`,
  `approve` and `release` for both actor types. `editDraft` remains for compatible
  clients. Capability flags describe authorization, not proven repository writes
  or renderer health. Archive capability remains false.

## Review and rendering limits

Status labels persist across edits. An approved/released badge does **not** establish
that the current content was reviewed, that a human performed the status change,
or that a PDF is frozen. Consult the exact `Reviewed-Blob`, commit author and history
for prior sign-off. PR #35 does not automatically clear labels or add a separate
current-version approval record; this UI/diagnostics follow-up does not alter its
backend metadata policy. `Approved-By`/`Approved-At` are legacy status-commit trailers,
not independent evidence of human review.

PDF downloads remain regenerable previews, not archived issued originals.
Source/assets can be pinned while branding/templates/renderer changes affect bytes.

## Companion changes outside this patch

- `Vanaheim-Labs/docgent-skills` main at `08a5ab6963c17c61e639ffea86b3f429a7ee63ed`
  still instructs agents to obtain human confirmation before acceptance and says
  the status lifecycle is linear. Update its propose/accept section, direct-PUT
  guidance, lifecycle description and pitfalls to make human review optional,
  while retaining scoped auth, vocabulary checks and exact-SHA reconciliation.
  Refresh installed copies only through their owning operator/profile.
- The separate, not-on-main workspace-policy foundation (`e078f8c`) denies agents
  `review.complete` and `status.change`. Before integrating that account work,
  remove those two actor-type restrictions when credential operation scope allows
  them, and update its tests/contract. Do not relax billing, credential management,
  workspace/profile isolation, expiry or entitlement checks. This patch does not
  import or edit that concurrent branch.

## Rollout

Apply after PR #35, rerun the full tests and production build, then use an authorized
preview/test workspace to smoke-test edit, accept, restore and status on signed-off
source plus stale and cross-brand denial. No document migration or credential change
is required. Parent/operator owns merge and deployment. Preserve append-only document
history during rollback; do not reset production document commits.
