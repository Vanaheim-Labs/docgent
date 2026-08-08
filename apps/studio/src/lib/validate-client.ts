/**
 * Client-side validation.
 *
 * Mirrors packages/vocabulary/src/validate.mjs, but runs in the browser as the
 * author types so registry errors surface immediately rather than at commit.
 * The server-side validator remains authoritative — this is an affordance, not
 * a gate. Save still validates before it commits.
 */
import type { Vocabulary } from "./vocabulary";

export type Diagnostic = {
  line: number;
  severity: "error" | "warning";
  message: string;
};

export function validateMarkdown(src: string, vocab: Vocabulary): Diagnostic[] {
  const out: Diagnostic[] = [];
  const lines = src.split("\n");
  const blockById = new Map(vocab.blocks.map((b) => [b.id, b]));

  // ---- frontmatter ----
  const fmMatch = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    out.push({ line: 1, severity: "error", message: "Missing YAML frontmatter block." });
  } else {
    const fm: Record<string, string> = {};
    fmMatch[1].split("\n").forEach((l) => {
      const kv = l.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
    });
    for (const key of vocab.frontmatter.required) {
      if (!fm[key]) {
        out.push({ line: 1, severity: "error", message: `Frontmatter missing required key: ${key}` });
      }
    }
    const known = new Set([...vocab.frontmatter.required, ...vocab.frontmatter.optional]);
    for (const key of Object.keys(fm)) {
      if (!known.has(key)) {
        out.push({ line: 1, severity: "warning", message: `Frontmatter key '${key}' is not in the registry.` });
      }
    }
    for (const [key, allowed] of Object.entries(vocab.frontmatter.enums)) {
      if (fm[key] && !allowed.includes(fm[key])) {
        out.push({
          line: 1,
          severity: "error",
          message: `Frontmatter '${key}' = '${fm[key]}' — allowed: ${allowed.join(", ")}`,
        });
      }
    }
  }

  // ---- fenced divs ----
  const stack: { id: string; line: number }[] = [];
  let inCode = false;

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (/^\s*```/.test(line)) { inCode = !inCode; return; }
    if (inCode) return;

    // raw HTML / inline style escape hatches
    if (/^\s*<(div|span|table|p|section|style|script|img|br|hr)\b/i.test(line)) {
      out.push({
        line: lineNo,
        severity: "error",
        message: "Raw HTML is not permitted. Add a vocabulary term instead.",
      });
    }
    if (/style\s*=\s*"/.test(line)) {
      out.push({ line: lineNo, severity: "error", message: "Inline style attributes are not permitted." });
    }

    const fence = line.match(/^(:{3,})\s*(.*)$/);
    if (!fence) return;
    const rest = fence[2].trim();

    if (rest === "") {
      if (stack.length === 0) {
        out.push({ line: lineNo, severity: "error", message: "Closing ':::' with no matching open." });
      } else {
        stack.pop();
      }
      return;
    }

    let id: string | null = null;
    const attrs: Record<string, string> = {};

    if (rest.startsWith("{")) {
      const inner = rest.replace(/^\{/, "").replace(/\}\s*$/, "");
      const classes: string[] = [];
      const re = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*("([^"]*)"|'([^']*)'|[^\s}]+)|\.([A-Za-z][A-Za-z0-9_-]*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(inner)) !== null) {
        if (m[1]) attrs[m[1]] = m[3] ?? m[4] ?? m[2];
        else if (m[5]) classes.push(m[5]);
      }
      if (!classes.length) {
        out.push({ line: lineNo, severity: "error", message: "Attribute fence has no block class, e.g. '{.callout}'." });
        return;
      }
      id = classes[0];
    } else {
      const bare = rest.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*$/);
      if (!bare) {
        out.push({ line: lineNo, severity: "error", message: `Unparseable fence opener: '${rest}'` });
        return;
      }
      id = bare[1];
    }

    const spec = blockById.get(id);
    if (!spec) {
      out.push({
        line: lineNo,
        severity: "error",
        message: `Unknown block ':::${id}'. Add the term to the registry rather than working around it.`,
      });
      stack.push({ id, line: lineNo });
      return;
    }

    for (const [name, value] of Object.entries(attrs)) {
      const attrSpec = spec.attrs[name];
      if (!attrSpec) {
        out.push({
          line: lineNo,
          severity: "error",
          message: `'${id}' has no attribute '${name}'. Allowed: ${Object.keys(spec.attrs).join(", ") || "(none)"}`,
        });
        continue;
      }
      if (attrSpec.type === "enum" && attrSpec.values && !attrSpec.values.includes(value)) {
        out.push({
          line: lineNo,
          severity: "error",
          message: `'${id}.${name}' = '${value}' — allowed: ${attrSpec.values.join(", ")}`,
        });
      }
      if (attrSpec.type === "boolean" && !/^(true|false)$/.test(value)) {
        out.push({ line: lineNo, severity: "error", message: `'${id}.${name}' must be true or false.` });
      }
      if (attrSpec.type === "integer" && !/^-?\d+$/.test(value)) {
        out.push({ line: lineNo, severity: "error", message: `'${id}.${name}' must be an integer.` });
      }
    }

    for (const [name, attrSpec] of Object.entries(spec.attrs)) {
      if (attrSpec.required && attrs[name] === undefined) {
        out.push({ line: lineNo, severity: "error", message: `'${id}' requires attribute '${name}'.` });
      }
    }

    stack.push({ id, line: lineNo });
  });

  for (const open of stack) {
    out.push({ line: open.line, severity: "error", message: `Block ':::${open.id}' is never closed.` });
  }

  // ---- inline spans ----
  const inlineRe = /\]\{\.([A-Za-z][A-Za-z0-9_-]*)/g;
  let im: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((im = inlineRe.exec(src)) !== null) {
    if (seen.has(im[1])) continue;
    seen.add(im[1]);
    if (!vocab.inlineIds.includes(im[1])) {
      const upto = src.slice(0, im.index).split("\n").length;
      out.push({ line: upto, severity: "warning", message: `Unknown inline class '.${im[1]}'.` });
    }
  }

  return out.sort((a, b) => a.line - b.line);
}
