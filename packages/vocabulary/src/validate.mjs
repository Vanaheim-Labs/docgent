#!/usr/bin/env node
// DocForge vocabulary validator.
// Enforces the contract in vocabulary.yaml: block ids, attribute names,
// enum values, required attributes, frontmatter keys, and the no-raw-HTML rule.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml, splitFrontmatter } from "@docforge/core/yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOCAB_PATH = path.join(__dirname, "..", "vocabulary.yaml");

/* ------------------------------------------------------------------ *
 * Registry loading
 * ------------------------------------------------------------------ */

/**
 * Parses the registry into a structured spec.
 * Shape: { blocks: { id: { attrs: { name: {type, values, required, default} } } },
 *          inlineIds: [], frontmatter: { required: [], optional: [], enums: {} } }
 */
function loadVocab() {
  const raw = fs.readFileSync(VOCAB_PATH, "utf8");
  const lines = raw.split("\n");

  const blocks = {};
  const inlineIds = [];
  const frontmatter = { required: [], optional: [], enums: {} };

  let section = null;      // 'blocks' | 'inlines' | 'frontmatter'
  let currentBlock = null;
  let inAttrs = false;
  let currentAttr = null;
  let fmSub = null;        // 'optional' | 'enums'

  for (const rawLine of lines) {
    if (!rawLine.trim() || /^\s*#/.test(rawLine)) continue;
    const indent = rawLine.match(/^\s*/)[0].length;
    const line = rawLine.trim();

    if (indent === 0) {
      if (line === "blocks:") { section = "blocks"; currentBlock = null; inAttrs = false; continue; }
      if (line === "inlines:") { section = "inlines"; currentBlock = null; inAttrs = false; continue; }
      if (line === "frontmatter:") { section = "frontmatter"; fmSub = null; continue; }
      section = null;
      continue;
    }

    if (section === "blocks") {
      const idm = line.match(/^-\s+id:\s*(\S+)/);
      if (idm && indent === 2) {
        currentBlock = idm[1];
        blocks[currentBlock] = { id: currentBlock, attrs: {} };
        inAttrs = false;
        currentAttr = null;
        continue;
      }
      if (!currentBlock) continue;
      if (indent === 4 && line === "attrs:") { inAttrs = true; continue; }
      if (indent === 4 && line !== "attrs:") { inAttrs = false; continue; }
      if (inAttrs && indent === 6) {
        // name: { type: enum, values: [a, b], default: a, required: true }
        const am = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*\{(.*)\}\s*$/);
        if (am) {
          const [, name, body] = am;
          const spec = { type: "string", values: null, required: false, default: undefined };
          const typeM = body.match(/type:\s*([A-Za-z]+)/);
          if (typeM) spec.type = typeM[1];
          const valuesM = body.match(/values:\s*\[([^\]]*)\]/);
          if (valuesM) spec.values = valuesM[1].split(",").map((s) => s.trim()).filter(Boolean);
          const reqM = body.match(/required:\s*(true|false)/);
          if (reqM) spec.required = reqM[1] === "true";
          const defM = body.match(/default:\s*([^,}]+)/);
          if (defM) spec.default = defM[1].trim();
          blocks[currentBlock].attrs[name] = spec;
          currentAttr = name;
        }
        continue;
      }
    }

    if (section === "inlines") {
      const idm = line.match(/^-\s+id:\s*(\S+)/);
      if (idm && indent === 2) inlineIds.push(idm[1]);
      continue;
    }

    if (section === "frontmatter") {
      const reqM = line.match(/^required:\s*\[([^\]]*)\]/);
      if (reqM) {
        frontmatter.required = reqM[1].split(",").map((s) => s.trim()).filter(Boolean);
        fmSub = null;
        continue;
      }
      if (line === "optional:") { fmSub = "optional"; continue; }
      if (line === "enums:") { fmSub = "enums"; continue; }
      if (fmSub === "optional") {
        const im = line.match(/^-\s*(\S+)/);
        if (im) frontmatter.optional.push(im[1]);
        continue;
      }
      if (fmSub === "enums") {
        const em = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*\[([^\]]*)\]/);
        if (em) {
          frontmatter.enums[em[1]] = em[2].split(",").map((s) => s.trim()).filter(Boolean);
        }
        continue;
      }
    }
  }

  return { blocks, blockIds: Object.keys(blocks), inlineIds, frontmatter };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function parseFrontmatter(src) {
  const { data, found } = splitFrontmatter(src);
  return found ? data : null;
}

/**
 * Parses a pandoc attribute brace: {.blockid key=value key="quoted value" #id .class}
 */
function parseAttrBrace(rest) {
  const inner = rest.replace(/^\{/, "").replace(/\}\s*$/, "");
  const attrs = {};
  const classes = [];
  const re = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*("([^"]*)"|'([^']*)'|[^\s}]+)|\.([A-Za-z][A-Za-z0-9_-]*)|#([A-Za-z][A-Za-z0-9_-]*)/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    if (m[1]) {
      attrs[m[1]] = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[2];
    } else if (m[5]) {
      classes.push(m[5]);
    }
  }
  return { attrs, classes };
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export function validateDoc(file) {
  const vocab = loadVocab();
  const src = fs.readFileSync(file, "utf8");
  const errors = [];
  const warnings = [];

  // ---- Frontmatter ----
  const fm = parseFrontmatter(src);
  if (!fm) {
    errors.push("Missing YAML frontmatter block at top of file.");
  } else {
    for (const key of vocab.frontmatter.required) {
      if (!fm[key]) errors.push(`Frontmatter missing required key: ${key}`);
    }
    const known = new Set([...vocab.frontmatter.required, ...vocab.frontmatter.optional]);
    for (const key of Object.keys(fm)) {
      if (!known.has(key)) {
        warnings.push(`Frontmatter key '${key}' is not in the registry (typo?).`);
      }
    }
    for (const [key, allowed] of Object.entries(vocab.frontmatter.enums)) {
      if (fm[key] && !allowed.includes(fm[key])) {
        errors.push(
          `Frontmatter '${key}' has value '${fm[key]}' — allowed: ${allowed.join(", ")}.`
        );
      }
    }
  }

  const lines = src.split("\n");

  // ---- Fenced divs ----
  // Legal opens:  '::: blockid'  or  '::: {.blockid attr=value}'
  // Legal close:  bare fence.
  const openStack = [];
  lines.forEach((line, i) => {
    const fence = line.match(/^(:{3,})\s*(.*)$/);
    if (!fence) return;
    const rest = fence[2].trim();
    const lineNo = i + 1;

    if (rest === "") {
      if (openStack.length === 0) {
        errors.push(`Line ${lineNo}: closing ':::' with no matching open.`);
      } else {
        openStack.pop();
      }
      return;
    }

    let id = null;
    let attrs = {};
    let extraClasses = [];

    if (rest.startsWith("{")) {
      const parsed = parseAttrBrace(rest);
      attrs = parsed.attrs;
      if (parsed.classes.length === 0) {
        errors.push(`Line ${lineNo}: attribute fence has no block class, e.g. '{.callout}'.`);
        return;
      }
      id = parsed.classes[0];
      extraClasses = parsed.classes.slice(1);
    } else {
      const bare = rest.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*$/);
      if (!bare) {
        errors.push(`Line ${lineNo}: unparseable fence opener: '${rest}'`);
        return;
      }
      id = bare[1];
    }

    const spec = vocab.blocks[id];
    if (!spec) {
      errors.push(
        `Line ${lineNo}: unknown block ':::' ${id}' — not in vocabulary registry. ` +
        `Add the term to vocabulary.yaml rather than working around it.`
      );
      openStack.push({ id, line: lineNo });
      return;
    }

    for (const cls of extraClasses) {
      if (!vocab.blocks[cls]) {
        warnings.push(`Line ${lineNo}: extra class '.${cls}' on '${id}' is not a registry term.`);
      }
    }

    // Attribute names
    for (const [name, value] of Object.entries(attrs)) {
      const attrSpec = spec.attrs[name];
      if (!attrSpec) {
        errors.push(
          `Line ${lineNo}: block '${id}' has no attribute '${name}'. ` +
          `Allowed: ${Object.keys(spec.attrs).join(", ") || "(none)"}.`
        );
        continue;
      }
      if (attrSpec.type === "enum" && attrSpec.values && !attrSpec.values.includes(value)) {
        errors.push(
          `Line ${lineNo}: '${id}.${name}' = '${value}' is not allowed. ` +
          `Allowed: ${attrSpec.values.join(", ")}.`
        );
      }
      if (attrSpec.type === "boolean" && !/^(true|false)$/.test(value)) {
        errors.push(`Line ${lineNo}: '${id}.${name}' must be true or false, got '${value}'.`);
      }
      if (attrSpec.type === "integer" && !/^-?\d+$/.test(value)) {
        errors.push(`Line ${lineNo}: '${id}.${name}' must be an integer, got '${value}'.`);
      }
    }

    // Required attributes
    for (const [name, attrSpec] of Object.entries(spec.attrs)) {
      if (attrSpec.required && attrs[name] === undefined) {
        errors.push(`Line ${lineNo}: block '${id}' requires attribute '${name}'.`);
      }
    }

    openStack.push({ id, line: lineNo });
  });

  for (const o of openStack) {
    errors.push(`Line ${o.line}: block ':::' ${o.id}' never closed.`);
  }

  // ---- Raw HTML / inline style escape hatches ----
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    if (/^\s*<(div|span|table|p|section|style|script|img|br|hr)\b/i.test(line)) {
      errors.push(`Line ${i + 1}: raw HTML is not permitted. Add a vocabulary term instead.`);
    }
    if (/style\s*=\s*"/.test(line)) {
      errors.push(`Line ${i + 1}: inline style attribute is not permitted.`);
    }
  });

  // ---- Inline spans ----
  const inlineUse = [...src.matchAll(/\]\{\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]);
  for (const id of new Set(inlineUse)) {
    if (!vocab.inlineIds.includes(id)) {
      warnings.push(`Unknown inline class '.${id}' — not in vocabulary registry.`);
    }
  }

  // ---- Referenced assets exist ----
  const docDir = path.dirname(path.resolve(file));
  const srcAttrs = [...src.matchAll(/\bsrc\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  for (const rel of new Set(srcAttrs)) {
    if (/^https?:\/\//.test(rel)) continue;
    if (!fs.existsSync(path.join(docDir, rel))) {
      errors.push(`Referenced asset not found: ${rel}`);
    }
  }

  return { file, ok: errors.length === 0, errors, warnings, frontmatter: fm };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const targets = args.filter((a) => !a.startsWith("--"));
  if (!targets.length) {
    console.error("usage: validate.mjs [--strict] <file.md> [...]");
    process.exit(2);
  }
  let failed = 0;
  for (const t of targets) {
    const r = validateDoc(t);
    const bad = !r.ok || (strict && r.warnings.length > 0);
    if (!bad && !r.warnings.length) {
      console.log(`✓ ${t}`);
    } else {
      if (bad) failed++;
      console.log(`${r.ok ? "⚠" : "✗"} ${t}`);
      r.errors.forEach((e) => console.log(`   ERROR  ${e}`));
      r.warnings.forEach((w) => console.log(`   WARN   ${w}`));
    }
  }
  process.exit(failed ? 1 : 0);
}
