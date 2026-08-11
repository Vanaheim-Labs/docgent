#!/usr/bin/env node
/**
 * DocForge render-time linter.
 *
 * The vocabulary validator (packages/vocabulary) checks the SOURCE: is this
 * markdown legal? This module checks the ARTEFACT: did the thing we produced
 * actually come out well?
 *
 * They are different failure classes. Source can be perfectly valid and still
 * render a heading that wraps four lines, a table wider than the safe area, or
 * a document whose fonts silently fell back to a system face. "VALID" should
 * mean the output is sound, not merely that pandoc parsed.
 *
 * Findings are advisory by default. Nothing here blocks a render — a linter
 * that stops you shipping a draft is a linter people switch off. Severity
 * 'error' is reserved for defects that make the PDF objectively wrong
 * (missing fonts, unresolved images, overflowing content).
 */

import zlib from "node:zlib";

/** @typedef {{ rule: string, severity: "error"|"warning"|"info", message: string, page?: number, context?: string }} Finding */

/* ------------------------------------------------------------------ *
 * HTML-level checks
 * These run on the pandoc output, before WeasyPrint sees it.
 * ------------------------------------------------------------------ */

/** Strips tags to get at readable text, preserving block boundaries. */
function textOf(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function* matchAll(html, re) {
  let m;
  while ((m = re.exec(html)) !== null) yield m;
}

/**
 * Headings that wrap to many lines read as a layout accident rather than a
 * decision. We cannot measure wrapping without laying out, so we approximate
 * by character count against the heading's type size.
 */
function checkHeadingLength(html) {
  /** @type {Finding[]} */
  const out = [];
  // Rough measure budget per heading level, in characters, at typical A4
  // measure. h1 is set large, so it fits far fewer characters per line.
  const BUDGET = { h1: 46, h2: 62, h3: 78 };
  const MAX_LINES = 3;

  for (const level of ["h1", "h2", "h3"]) {
    const re = new RegExp(`<${level}[^>]*>([\\s\\S]*?)<\\/${level}>`, "gi");
    for (const m of matchAll(html, re)) {
      const text = textOf(m[1]);
      if (!text) continue;
      const lines = Math.ceil(text.length / BUDGET[level]);
      if (lines > MAX_LINES) {
        out.push({
          rule: "heading-wrap",
          severity: "warning",
          message: `${level.toUpperCase()} is ~${lines} lines long. Headings over ${MAX_LINES} lines read as an accident; shorten it or add a manual break.`,
          context: text.slice(0, 80),
        });
      }
    }
  }
  return out;
}

/**
 * A table with many columns cannot fit the measure at body size. WeasyPrint
 * will shrink or overflow it rather than telling you.
 */
function checkTableWidth(html) {
  /** @type {Finding[]} */
  const out = [];
  const MAX_COLS = 7;
  for (const m of matchAll(html, /<table[\s\S]*?<\/table>/gi)) {
    const table = m[0];
    const firstRow = table.match(/<tr[\s\S]*?<\/tr>/i);
    if (!firstRow) continue;
    const cols = (firstRow[0].match(/<t[hd]\b/gi) || []).length;
    if (cols > MAX_COLS) {
      out.push({
        rule: "table-columns",
        severity: "warning",
        message: `Table has ${cols} columns. Beyond ${MAX_COLS} the type must shrink below the readable minimum — consider landscape, splitting it, or transposing.`,
      });
    }
    // A cell carrying a paragraph of prose is a sign the data wants to be
    // a different structure entirely.
    for (const cell of matchAll(table, /<td[^>]*>([\s\S]*?)<\/td>/gi)) {
      const t = textOf(cell[1]);
      if (t.length > 220) {
        out.push({
          rule: "table-cell-prose",
          severity: "info",
          message: `A table cell holds ${t.length} characters of prose. Tables are for comparison; long text belongs in body copy or a callout.`,
          context: t.slice(0, 80),
        });
        break; // one report per table is enough
      }
    }
  }
  return out;
}

/** Images that never resolved leave a broken box in the PDF. */
function checkImages(html) {
  /** @type {Finding[]} */
  const out = [];
  for (const m of matchAll(html, /<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = (tag.match(/src\s*=\s*"([^"]*)"/i) || [])[1] || "";
    if (!src) {
      out.push({ rule: "image-src", severity: "error", message: "An <img> has no src; it will render as an empty box." });
      continue;
    }
    if (/^https?:/i.test(src)) {
      out.push({
        rule: "image-remote",
        severity: "warning",
        message: `Image is fetched over the network (${src.slice(0, 60)}). Renders become non-reproducible and fail offline; commit the asset instead.`,
      });
    }
    if (!/alt\s*=/i.test(tag)) {
      out.push({ rule: "image-alt", severity: "info", message: `Image has no alt text (${src.slice(0, 60)}).` });
    }
  }
  return out;
}

/**
 * Raw HTML in the output that did not come from a vocabulary term means an
 * author bypassed the registry. The source validator catches most of this;
 * this catches what slipped through a fenced div.
 */
function checkInlineStyles(html) {
  /** @type {Finding[]} */
  const out = [];
  const body = html.replace(/<head[\s\S]*?<\/head>/i, "");
  const count = (body.match(/\sstyle\s*=\s*"/gi) || []).length;
  if (count > 0) {
    out.push({
      rule: "inline-style",
      severity: "warning",
      message: `${count} inline style attribute(s) reached the output. Styling belongs in the brand stylesheet, not the document.`,
    });
  }
  return out;
}

/** Documents that declare a TOC but produce no entries ship an empty page. */
function checkToc(html) {
  /** @type {Finding[]} */
  const out = [];
  const toc = html.match(/<nav[^>]*id="TOC"[\s\S]*?<\/nav>/i);
  if (toc && !/<li\b/i.test(toc[0])) {
    out.push({
      rule: "toc-empty",
      severity: "warning",
      message: "A table of contents was requested but contains no entries.",
    });
  }
  return out;
}

/**
 * Runs every HTML-level rule.
 * @param {string} html
 * @returns {Finding[]}
 */
export function lintHtml(html) {
  return [
    ...checkHeadingLength(html),
    ...checkTableWidth(html),
    ...checkImages(html),
    ...checkInlineStyles(html),
    ...checkToc(html),
  ];
}

/* ------------------------------------------------------------------ *
 * PDF-level checks
 * These need the laid-out artefact: page count, fonts, overflow.
 * ------------------------------------------------------------------ */

/**
 * Reads structural facts out of a PDF buffer without a full parser.
 *
 * We only need page count and font embedding, and both have stable markers, so
 * a dependency-free scan beats pulling a PDF library into both the CLI and the
 * render worker image.
 *
 * The catch: WeasyPrint writes cross-reference and object streams, so the page
 * objects are deflated and invisible to a scan of the raw bytes. An earlier
 * version reported 'pages: 0' on every WeasyPrint PDF and fired a spurious
 * pdf-empty error. We therefore inflate every stream we can and search the
 * decompressed payload as well as the envelope.
 *
 * @param {Buffer|Uint8Array} buf
 */
export function pdfFacts(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);

  // Search the raw envelope plus every inflatable stream body.
  const haystacks = [bytes.toString("latin1")];
  const STREAM = /stream\r?\n/g;
  let m;
  while ((m = STREAM.exec(bytes.toString("latin1"))) !== null) {
    const start = m.index + m[0].length;
    const end = bytes.indexOf("endstream", start, "latin1");
    if (end < 0) continue;
    try {
      haystacks.push(zlib.inflateSync(bytes.subarray(start, end)).toString("latin1"));
    } catch {
      // Not a deflate stream (image data, already-plain content). Skipping is
      // correct: those never carry page or font dictionaries.
    }
  }

  let pages = 0;
  const fontNames = new Set();
  const embedded = new Set();
  let hasFontFile = false;

  for (const hay of haystacks) {
    pages += (hay.match(/\/Type\s*\/Page[^s]/g) || []).length;
    if (/\/FontFile[23]?\b/.test(hay)) hasFontFile = true;
    for (const f of matchAll(hay, /\/BaseFont\s*\/([A-Za-z0-9+\-_,.]+)/g)) {
      // Subset fonts are prefixed 'ABCDEF+', which is itself the proof that
      // the face was embedded rather than merely referenced.
      const raw = f[1];
      const name = raw.replace(/^[A-Z]{6}\+/, "").replace(/,$/, "");
      fontNames.add(name);
      if (/^[A-Z]{6}\+/.test(raw)) embedded.add(name);
    }
  }

  return {
    pages,
    fonts: [...fontNames],
    embeddedFonts: [...embedded],
    hasEmbeddedFontData: hasFontFile,
    bytes: bytes.length,
  };
}

/**
 * @param {Buffer|Uint8Array} buf
 * @param {{ requireEvenPages?: boolean }} [opts]
 * @returns {Finding[]}
 */
export function lintPdf(buf, opts = {}) {
  /** @type {Finding[]} */
  const out = [];
  const facts = pdfFacts(buf);

  if (facts.pages === 0) {
    out.push({ rule: "pdf-empty", severity: "error", message: "The PDF contains no pages." });
    return out;
  }

  // A brand's typography is the brand. If the faces did not embed, the file
  // renders in a substitute on any machine that lacks them.
  if (!facts.hasEmbeddedFontData) {
    out.push({
      rule: "font-embedding",
      severity: "error",
      message: "No embedded font data found. The document will substitute system faces when opened elsewhere.",
    });
  }

  // Print work is imposed in spreads; an odd final page leaves a stray leaf.
  if (opts.requireEvenPages && facts.pages % 2 !== 0) {
    out.push({
      rule: "page-parity",
      severity: "info",
      message: `Document is ${facts.pages} pages. Print imposition prefers an even count.`,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

const ORDER = { error: 0, warning: 1, info: 2 };

/** @param {Finding[]} findings */
export function summarise(findings) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return {
    ok: counts.error === 0,
    counts,
    findings: [...findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]),
  };
}

/**
 * Human-readable report. Mirrors the tick/warning style already used in the
 * Studio status strip.
 * @param {Finding[]} findings
 */
export function formatReport(findings) {
  if (!findings.length) return "\u2713 No render issues found.";
  const glyph = { error: "\u2717", warning: "\u26a0", info: "\u00b7" };
  return summarise(findings)
    .findings.map((f) => `${glyph[f.severity]} [${f.rule}] ${f.message}${f.context ? `\n    \u2192 ${f.context}` : ""}`)
    .join("\n");
}
