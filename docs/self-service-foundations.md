# Self-service foundations — reviewed rollout subset

Local work on `feat/self-service-foundations`, based on `0b435a829aaea874204868821be4deaca4a2ae12`. No commit, push, deployment, production writes, credential/configuration changes, document migration or model calls. Parent owns independent re-review and deployment authorization.

This is an internal foundation for GTM-02/03/04/09, not paid Solo, stranger onboarding or public-launch readiness.

## Shipping behavior

### Cycle 2 — exact-source review (updated by free-flowing editing)

- Lifecycle POST accepts brand-authorized human sessions and bearer agents with the exact current full blob SHA (`baseSha`). Missing/malformed precondition returns 428; stale returns 409. Any valid status may be selected; no implicit HEAD replacement.
- Actor identity comes from authorization; `Reviewed-Blob` is retained in Git trailers. An agent action is not human review, and a status label is not proof that current content was inspected. Labels persist across edits.
- Details exposes source, exact SHA and optional review/status controls without an acknowledgement gate. Historical/unidentified source cannot change status until the current version is loaded.
- Authorization checks brand membership at the route boundary. Explicit credentials cannot inherit ambient session authority. Malformed bearer syntax is rejected before validation; session-provider failure denies access without upstream details.

### Cycle 3 — free-flowing editing with version preconditions

- Raw PUT, accepted rewrite, restore and DELETE apply concurrency-only `editorialGuard`. New documents may use any valid status. Authorized agents and people can edit, restore, or set status regardless of lifecycle.
- Existing edits/restores require exact current `baseSha`; DELETE requires the unquoted full blob SHA in `If-Match`. Store-level CAS remains intact. A deletion race is now an actionable 409 rather than 500.
- Approved/released/superseded documents retain Edit, comment-edit and restore controls. Direct edit URLs open the editor. Review and lifecycle labels never lock content.
- Restore continues sending the SHA displayed at page load. Historical views must return to current, not silently fetch a newer SHA at click time.

### Cycle 4 — archive implementation DEFERRED; compatible previews retained

The independently reviewed archive experiment was removed from application source and invocation. Non-executable snapshots and re-entry blockers are in [`deferred-cycle4/README.md`](deferred-cycle4/README.md). There is **no flag or deployed configuration that can activate it**.

- Legacy approved → released remains a Git lifecycle transition, now brand-authorized/exact-SHA protected. It does not call the renderer/archive, inventory or newly prohibit binary assets, wait for PDF persistence, or add artifact-identity trailers.
- Existing released/superseded documents remain downloadable through the legacy preview path. Cache misses regenerate PDFs. They are **regenerable previews, not archived originals**; no assertion is made about previously issued bytes.
- Source and assets are pinned to one concrete commit; mutable render refs are rejected. Renderer/templates may still drift. Browser headers do not promise immutable PDFs.
- Cache writes remain best effort for previews. Existing gateway conditional-write/error handling and accurate cache-driver detection remain, but do not establish an archive product or verified durability.
- The original blockers are not claimed fixed: markdown-only archive identity and poisoned retries after a failed Git commit; status 60-second budget versus renderer 120 seconds plus persistence; lack of lossless binary reads; legacy missing artifacts. Re-entry requires a separately reviewed design and failure/recovery tests.

### Cycle 5 — honest connection diagnostics

`GET /api/auth/check/<brand>` remains read-only, keeps `valid`, `brand`, `brandName`, `via`, and adds safe credential remedies, a real repository HEAD check, no-store headers, renderer configuration-only checks and scoped readiness. No upstream error text/tokens/document contents are returned.

`releaseArchive` is always `{ok:false, verified:false, code:"deferred", ...}`. `capabilities.archiveRelease` is always false, even with an R2-configured preview cache. Human and agent `capabilities.release` means the legacy lifecycle transition only. Overall readiness covers repository read and renderer configuration, not tested rendering or archived-release readiness.

## Original foundation regression evidence (historical)

Earlier source-review/editorial/connection regression coverage remains active. Assertions specifically enforcing the rejected archive rollout were removed from the shipping suite and preserved as text snapshots; they are not skipped passing claims.

- `rollout.test.mjs`: first RED had 3 expected 503-vs-200 failures for legacy released/superseded PDF availability and archive-free release; after that slice went green, diagnostics/delete regressions reproduced true-vs-false archive readiness and 500-vs-409 deletion race. All now pass.
- `rollout-ui.test.mjs`: lock-control tests first failed because Edit stayed enabled; direct edit URL tests first failed because Editor was still rendered. All now pass.
- `auth-regression.test.mjs`: first RED rejected neither malformed bearer tokens nor a thrown auth provider failure (2 failures, 1 existing passing rejected-token case). All now pass.
- Tests invoke actual transpiled route/component modules, real core parsing and store logic with I/O boundaries substituted. PNG fixtures verify no newly imposed asset rejection; they are not proof of real binary rendering fidelity.

## Original foundation verification (historical)

After narrow dependency remediation and a clean `npm ci --ignore-scripts`:

- `npm test`: **80 passed, 0 failed, 0 skipped**.
- `npm exec --workspace apps/studio -- next build`: **success** with Next 15.5.25, production compilation, lint/type checking, static generation and traces. Direct invocation avoids brands-cloning prebuild.
- `npm audit --omit=dev`: **0 vulnerabilities reported**. See [`security-dependencies.md`](security-dependencies.md) for exact versions, compatibility and limits.
- `git diff --check`: success.

No real OAuth login, production renderer/gateway, binary document fixture, staging deployment or browser interaction was exercised. Passing these checks is not independent review or public readiness.

## Rollout / rollback — parent/operator only

1. Independently review the application/dependency diff and rerun tests/build. Keep public signup closed.
2. Communicate intentional safety contract changes: human and agent status changes; full `baseSha` for existing edits/restores; `If-Match` for deletion. Clients must not silently retry with unseen source SHA.
3. In authorized staging, verify existing released/superseded PDF availability, edits and accepted rewrites at every status, exact-SHA human/agent transitions, stale-delete 409 and restore controls. PDFs remain previews; no archive backfill or new storage configuration is required.
4. Verify real sign-in after the Auth.js patch. Security audit is dependency-advisory evidence, not a complete security assessment.
5. Deploy only after parent approval. No migration accompanies this subset. Archive creation/retrieval must not be enabled by restoring imports or adding an environment flag.
6. Roll back the application to the prior reviewed build if necessary; preserve Git history/cache objects. Prior permissive routes have known safety gaps, so suspend approval/release operations rather than treating rollback as equivalent protection.

## Remaining limits

No public workspace provisioning, customer credential issuance/revocation, billing/entitlements, usage accounting, account export/deletion/trial lifecycle or public purchase flow. Shared brand tokens/Google allowlists remain internal mechanisms, not a customer account model. Direct Git writers remain trusted and can bypass application policy. Restore version high-water discovery still uses the existing bounded history/fallback behavior. Source identity does not attest external asset/template/renderer identity.

Hosted internal model rewrites remain enabled for authorized internal users. Public Solo still requires separation from that operator-funded path.
