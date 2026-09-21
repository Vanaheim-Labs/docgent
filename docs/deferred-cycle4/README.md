# Cycle 4: deferred, non-executable archive experiment

The `.txt` snapshots in this directory preserve the rejected local archive helper and its earlier tests as design evidence only. They are outside application source, have no importable TypeScript module or exposed invocation, and are not part of the runnable test suite. Their assertions/comments describe the rejected experiment, NOT guarantees of this build.

## Why it cannot ship

- Archive-only PDF retrieval returned 503 for existing released/superseded documents with no new-format artifact.
- A markdown-only key misses asset/template/renderer identity. An archive written before a failed Git commit can permanently poison a later retry after assets change. Calling these orphans harmless was incorrect.
- Status route budget was 60 seconds, while rendering could consume 120 seconds and persistence another 45 seconds. Increasing a constant does not establish a supported recovery protocol or hosting budget.
- The text-only Git reader cannot archive binary assets losslessly. Prohibiting all non-SVG assets in existing release flows is a rollout regression.

## Current deployable subset

No archive flag exists. Configuration cannot enable the experiment. The status route performs the legacy Git lifecycle transition with brand authorization and exact-source-SHA protections; humans and agents can change status. All PDF statuses use disposable preview caching and regenerate on a miss. Preview source/assets are pinned to one commit, but renderer/template drift is possible. These are not archived/original issued PDFs. Diagnostics always report archive capability false and deferred, independently of cache configuration.

## Re-entry acceptance gates

A separately reviewed design must establish lossless binary reads; complete artifact identity; recovery after failed Git commit, concurrent edits and nondeterministic re-render; supported end-to-end time budgets; durable storage semantics/retention/readback; honest legacy-document compatibility and explicit artifact approval semantics. Add failing regression tests for those cases before restoring any production invocation. Do not enable this by an environment variable, backfill re-rendered PDFs as originals, overwrite evidence on retry, or treat the old snapshots' tests as sufficient proof.
