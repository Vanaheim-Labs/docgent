import { parseFrontmatter } from "@docgent/core/yaml";

type Head = { sha: string; frontmatter?: Record<string, unknown> };
/**
 * Stale-write guard only.
 *
 * Previously this function also enforced:
 *   - New documents must start as draft
 *   - Edits blocked on approved/released/superseded documents
 *   - Status changes via raw frontmatter blocked (human gate required)
 *
 * All three lifecycle gates have been removed. Any authorised token may edit
 * at any status and set any status directly in frontmatter. Version control
 * is the audit trail; bearer-token auth is the access boundary.
 *
 * What remains is pure optimistic-concurrency protection: if the document
 * moved between read and write, the caller gets a 409 with enough context to
 * reload and retry. Silent overwrites of concurrent edits are still refused.
 */
export function editorialGuard(head: Head | null, content: string, baseSha: unknown): Response | null {
  // New document — no SHA expected, nothing to check.
  if (!head) {
    if (baseSha) return conflict("The document no longer exists. Reload before creating it.");
    return null;
  }
  // Existing document — baseSha is required and must match HEAD.
  if (typeof baseSha !== "string" || !/^[a-f0-9]{40}$/.test(baseSha)) {
    return Response.json({ error: "version_required", hint: "Send the inspected document blob SHA as baseSha." }, { status: 428 });
  }
  if (head.sha !== baseSha) return conflict("The document changed. Reload and reconcile your edit.");
  return null;
}

// parseFrontmatter is imported but no longer used in this file; keep the import
// so callers that import both symbols from here don't break.
void parseFrontmatter;

function conflict(hint: string) {
  return Response.json({ error: "editorial_conflict", hint, message: hint }, { status: 409 });
}
