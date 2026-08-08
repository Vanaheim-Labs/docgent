#!/usr/bin/env node
// DocForge vocabulary validator.
// Scans markdown for fenced divs and inline spans, checks against vocabulary.yaml.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOCAB_PATH = path.join(__dirname, "..", "vocabulary.yaml");

// Minimal YAML reader for our known-shape registry (avoids a dep at this layer).
function loadVocab() {
  const raw = fs.readFileSync(VOCAB_PATH, "utf8");
  const blocks = [...raw.matchAll(/^\s{2}-\s+id:\s*(\S+)/gm)].map((m) => m[1]);
  const section = (name) => {
    const idx = raw.indexOf(name + ":");
    return idx === -1 ? "" : raw.slice(idx);
  };
  const blockIds = [...section("blocks").matchAll(/^\s{2}-\s+id:\s*(\S+)/gm)]
    .map((m) => m[1]);
  const inlineSection = raw.slice(raw.indexOf("inlines:"), raw.indexOf("frontmatter:"));
  const inlineIds = [...inlineSection.matchAll(/^\s{2}-\s+id:\s*(\S+)/gm)].map((m) => m[1]);
  const fmSection = raw.slice(raw.indexOf("frontmatter:"));
  const required = (fmSection.match(/required:\s*\[([^\]]+)\]/) || [,""])[1]
    .split(",").map((s) => s.trim()).filter(Boolean);
  return { blockIds, inlineIds, required, all: blocks };
}

function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

export function validateDoc(file) {
  const vocab = loadVocab();
  const src = fs.readFileSync(file, "utf8");
  const errors = [];
  const warnings = [];

  // Frontmatter
  const fm = parseFrontmatter(src);
  if (!fm) {
    errors.push("Missing YAML frontmatter block at top of file.");
  } else {
    for (const key of vocab.required) {
      if (!fm[key]) errors.push(`Frontmatter missing required key: ${key}`);
    }
  }

  const lines = src.split("\n");

  // Fenced divs.
  // Two open forms are legal:
  //   ::: blockid
  //   ::: {.blockid attr=value ...}
  // A close is a bare fence with nothing after it.
  const openStack = [];
  lines.forEach((line, i) => {
    const fence = line.match(/^(:{3,})\s*(.*)$/);
    if (!fence) return;
    const rest = fence[2].trim();
    const close = rest === "";
    let id = null;
    if (!close) {
      const braced = rest.match(/^\{\s*\.([A-Za-z][A-Za-z0-9_-]*)/);
      const bare = rest.match(/^([A-Za-z][A-Za-z0-9_-]*)/);
      if (braced) id = braced[1];
      else if (bare) id = bare[1];
      else {
        errors.push(`Line ${i + 1}: unparseable fence opener: ${rest}`);
        return;
      }
    }
    if (!close) {
      if (!vocab.blockIds.includes(id)) {
        errors.push(`Line ${i + 1}: unknown block ':::' ${id}' — not in vocabulary registry.`);
      }
      openStack.push({ id, line: i + 1 });
    } else if (close) {
      if (openStack.length === 0) errors.push(`Line ${i + 1}: closing ':::' with no matching open.`);
      else openStack.pop();
    }
  });
  for (const o of openStack) {
    errors.push(`Line ${o.line}: block ':::' ${o.id}' never closed.`);
  }

  // Raw HTML escape hatch
  lines.forEach((line, i) => {
    if (/^\s*<(div|span|table|p|section|style|script)\b/i.test(line)) {
      errors.push(`Line ${i + 1}: raw HTML is not permitted. Add a vocabulary term instead.`);
    }
    if (/style\s*=\s*"/.test(line)) {
      errors.push(`Line ${i + 1}: inline style attribute is not permitted.`);
    }
  });

  // Inline spans
  const inlineUse = [...src.matchAll(/\]\{\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]);
  for (const id of new Set(inlineUse)) {
    if (!vocab.inlineIds.includes(id)) {
      warnings.push(`Unknown inline class '.${id}' — not in vocabulary registry.`);
    }
  }

  return { file, ok: errors.length === 0, errors, warnings, frontmatter: fm };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const targets = process.argv.slice(2);
  if (!targets.length) {
    console.error("usage: validate.mjs <file.md> [...]");
    process.exit(2);
  }
  let failed = 0;
  for (const t of targets) {
    const r = validateDoc(t);
    if (r.ok && !r.warnings.length) {
      console.log(`✓ ${t}`);
    } else {
      if (!r.ok) failed++;
      console.log(`${r.ok ? "⚠" : "✗"} ${t}`);
      r.errors.forEach((e) => console.log(`   ERROR  ${e}`));
      r.warnings.forEach((w) => console.log(`   WARN   ${w}`));
    }
  }
  process.exit(failed ? 1 : 0);
}
