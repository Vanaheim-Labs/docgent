/**
 * Semantic diff for DocForge documents.
 *
 * A raw markdown diff is noise: rewrapping a paragraph shows as a wholesale
 * rewrite, and a changed keyfigure looks identical to a changed adjective.
 * Reviewers need to know what changed *in document terms* - "keyfigure value
 * 4.2M -> 4.8M", "risk callout added in section 3", "recommendation R2 removed".
 *
 * This parses both revisions into a structural outline and diffs that, falling
 * back to line-level detail only inside prose.
 */

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

const FENCE_OPEN = /^(:{3,})\s*(.+)$/;
const FENCE_CLOSE = /^:{3,}\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;

function parseAttrBrace(rest) {
  const inner = rest.replace(/^\{/, "").replace(/\}\s*$/, "");
  const attrs = {};
  const classes = [];
  const re = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*("([^"]*)"|'([^']*)'|[^\s}]+)|\.([A-Za-z][A-Za-z0-9_-]*)/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    if (m[1]) attrs[m[1]] = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[2];
    else if (m[5]) classes.push(m[5]);
  }
  return { attrs, classes };
}

// Imported (not just re-exported) so this module can use it locally too.
import { parseFrontmatter } from "@docforge/core/yaml";
export { parseFrontmatter };

/**
 * Produces a flat list of structural nodes with a stable-ish identity, so the
 * diff can tell "moved" from "changed" and "added" from "edited".
 */
export function outline(src) {
  const text = String(src);
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  const lines = body.split("\n");

  const nodes = [];
  const stack = [];
  let section = null;
  let prose = [];

  const flushProse = () => {
    const joined = prose.join(" ").replace(/\s+/g, " ").trim();
    if (joined) {
      nodes.push({
        kind: "prose",
        section,
        text: joined,
        words: joined.split(/\s+/).length,
      });
    }
    prose = [];
  };

  let inCode = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inCode = !inCode; prose.push(line); continue; }
    if (inCode) { prose.push(line); continue; }

    const h = line.match(HEADING);
    if (h) {
      flushProse();
      section = h[2].trim();
      nodes.push({ kind: "heading", level: h[1].length, text: section, section });
      continue;
    }

    const open = line.match(FENCE_OPEN);
    if (open) {
      flushProse();
      const rest = open[2].trim();
      let id = null;
      let attrs = {};
      if (rest.startsWith("{")) {
        const p = parseAttrBrace(rest);
        id = p.classes[0] || null;
        attrs = p.attrs;
      } else {
        const bare = rest.match(/^([A-Za-z][A-Za-z0-9_-]*)/);
        id = bare ? bare[1] : null;
      }
      if (id) {
        const node = { kind: "block", id, attrs, section, body: [] };
        nodes.push(node);
        stack.push(node);
      }
      continue;
    }

    if (FENCE_CLOSE.test(line)) {
      flushProse();
      stack.pop();
      continue;
    }

    if (stack.length) {
      stack[stack.length - 1].body.push(line);
    } else {
      prose.push(line);
    }
  }
  flushProse();

  // Normalise block bodies once, rather than on every comparison.
  for (const n of nodes) {
    if (n.kind === "block") {
      n.bodyText = n.body.join(" ").replace(/\s+/g, " ").trim();
      delete n.body;
    }
  }

  return nodes;
}

/* ------------------------------------------------------------------ *
 * Diffing
 * ------------------------------------------------------------------ */

/** Identity used for matching nodes across revisions. */
function identity(n) {
  if (n.kind === "heading") return `h${n.level}:${n.text.toLowerCase()}`;
  if (n.kind === "block") {
    // Prefer an explicit ref/term/label if the vocabulary provides one - those
    // are author-assigned and stable across edits.
    const ref = n.attrs.ref || n.attrs.term || n.attrs.label || n.attrs.title;
    return ref ? `${n.id}:${String(ref).toLowerCase()}` : `${n.id}@${n.section || ""}`;
  }
  return `prose@${n.section || ""}`;
}

function shortText(s, n = 90) {
  const t = String(s || "").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

/**
 * Diffs two document revisions structurally.
 * Returns { changes: [...], summary: {...} }.
 */
export function semanticDiff(beforeSrc, afterSrc) {
  const beforeFm = parseFrontmatter(beforeSrc);
  const afterFm = parseFrontmatter(afterSrc);
  const before = outline(beforeSrc);
  const after = outline(afterSrc);

  const changes = [];

  // ---- frontmatter ----
  const fmKeys = new Set([...Object.keys(beforeFm), ...Object.keys(afterFm)]);
  for (const key of [...fmKeys].sort()) {
    const b = beforeFm[key];
    const a = afterFm[key];
    if (b === a) continue;
    if (b === undefined) {
      changes.push({ type: "metadata_added", key, after: a, detail: `${key}: ${a}` });
    } else if (a === undefined) {
      changes.push({ type: "metadata_removed", key, before: b, detail: `${key} (was ${b})` });
    } else {
      changes.push({
        type: "metadata_changed",
        key,
        before: b,
        after: a,
        detail: `${key}: ${b} → ${a}`,
      });
    }
  }

  // ---- structural nodes ----
  const beforeByKey = new Map();
  before.forEach((n, i) => {
    const k = identity(n);
    if (!beforeByKey.has(k)) beforeByKey.set(k, []);
    beforeByKey.get(k).push({ node: n, index: i });
  });

  const matchedBefore = new Set();

  after.forEach((n, i) => {
    const k = identity(n);
    const candidates = beforeByKey.get(k);
    const match = candidates?.find((c) => !matchedBefore.has(c.index));

    if (!match) {
      if (n.kind === "block") {
        changes.push({
          type: "block_added",
          block: n.id,
          section: n.section,
          detail: describeBlock(n),
        });
      } else if (n.kind === "heading") {
        changes.push({
          type: "section_added",
          section: n.text,
          detail: `${"#".repeat(n.level)} ${n.text}`,
        });
      } else if (n.words > 8) {
        changes.push({
          type: "prose_added",
          section: n.section,
          words: n.words,
          detail: shortText(n.text),
        });
      }
      return;
    }

    matchedBefore.add(match.index);
    const b = match.node;

    if (n.kind === "block") {
      // Attribute changes are the highest-signal edits in a business document:
      // a changed keyfigure value or recommendation priority matters far more
      // than a reworded sentence.
      const keys = new Set([...Object.keys(b.attrs), ...Object.keys(n.attrs)]);
      for (const key of [...keys].sort()) {
        if (b.attrs[key] !== n.attrs[key]) {
          changes.push({
            type: "attribute_changed",
            block: n.id,
            section: n.section,
            key,
            before: b.attrs[key],
            after: n.attrs[key],
            detail: `${n.id}.${key}: ${b.attrs[key] ?? "—"} → ${n.attrs[key] ?? "—"}`,
          });
        }
      }
      if (b.bodyText !== n.bodyText) {
        changes.push({
          type: "block_edited",
          block: n.id,
          section: n.section,
          detail: describeBlock(n),
        });
      }
    } else if (n.kind === "prose" && b.text !== n.text) {
      const delta = n.words - b.words;
      changes.push({
        type: "prose_edited",
        section: n.section,
        wordDelta: delta,
        detail: shortText(n.text),
      });
    }
  });

  before.forEach((n, i) => {
    if (matchedBefore.has(i)) return;
    if (n.kind === "block") {
      changes.push({
        type: "block_removed",
        block: n.id,
        section: n.section,
        detail: describeBlock(n),
      });
    } else if (n.kind === "heading") {
      changes.push({
        type: "section_removed",
        section: n.text,
        detail: `${"#".repeat(n.level)} ${n.text}`,
      });
    } else if (n.words > 8) {
      changes.push({
        type: "prose_removed",
        section: n.section,
        words: n.words,
        detail: shortText(n.text),
      });
    }
  });

  const summary = changes.reduce((acc, c) => {
    acc[c.type] = (acc[c.type] || 0) + 1;
    return acc;
  }, {});
  summary.total = changes.length;

  return { changes, summary };
}

function describeBlock(n) {
  const label =
    n.attrs.ref ||
    n.attrs.term ||
    n.attrs.title ||
    n.attrs.value ||
    n.attrs.kind ||
    null;
  const where = n.section ? ` in "${n.section}"` : "";
  return label ? `${n.id} (${label})${where}` : `${n.id}${where}`;
}

/** One-line human summary, for commit bodies and timeline captions. */
export function summarise(diff) {
  const s = diff.summary;
  if (!s.total) return "No structural changes";
  const parts = [];
  const add = (n, singular, plural) => {
    if (n) parts.push(`${n} ${n === 1 ? singular : plural || singular + "s"}`);
  };
  add((s.block_added || 0), "block added", "blocks added");
  add((s.block_removed || 0), "block removed", "blocks removed");
  add((s.block_edited || 0), "block edited", "blocks edited");
  add((s.attribute_changed || 0), "value changed", "values changed");
  add((s.section_added || 0), "section added", "sections added");
  add((s.section_removed || 0), "section removed", "sections removed");
  add((s.prose_edited || 0) + (s.prose_added || 0) + (s.prose_removed || 0), "prose edit", "prose edits");
  add(
    (s.metadata_changed || 0) + (s.metadata_added || 0) + (s.metadata_removed || 0),
    "metadata change",
    "metadata changes"
  );
  return parts.join(", ");
}
