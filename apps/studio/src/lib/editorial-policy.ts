import { parseFrontmatter } from "@docgent/core/yaml";

type Head = { sha: string; frontmatter?: Record<string, unknown> };
/** Editorial writes cannot assert approval, or modify a signed-off issue. */
export function editorialGuard(head: Head | null, content: string, baseSha: unknown): Response | null {
  const proposed = parseFrontmatter(content).status || "draft";
  if (!head) {
    if (proposed !== "draft") return conflict("New documents must start in draft.");
    if (baseSha) return conflict("The document no longer exists. Reload before creating it.");
    return null;
  }
  if (typeof baseSha !== "string" || !/^[a-f0-9]{40}$/.test(baseSha)) {
    return Response.json({ error: "version_required", hint: "Send the inspected document blob SHA as baseSha." }, { status: 428 });
  }
  if (head.sha !== baseSha) return conflict("The document changed. Reload and reconcile your edit.");
  const status = head.frontmatter?.status || "draft";
  if (!["draft", "review"].includes(String(status))) {
    return conflict("This issue is locked. Return approved work to review through the human status gate; create a new document for a released issue.");
  }
  if (proposed !== status) return conflict("Use the human status gate to change lifecycle status.");
  return null;
}
function conflict(hint: string) {
  return Response.json({ error: "editorial_conflict", hint, message: hint }, { status: 409 });
}
