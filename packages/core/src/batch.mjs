/**
 * Batch document production.
 *
 * The original motivation for Docgent: an agent generating N documents from a
 * data source, each one compliant with the vocabulary and the brand design
 * system, without the agent needing to know how any of it works.
 *
 * Design rules learned the hard way:
 *   - Validate BEFORE rendering. A render is ~1.3s against the worker; a
 *     validation failure is instant. Failing fast on 50 bad documents saves
 *     a minute of pointless worker load.
 *   - Never abort the whole batch on one bad record. Collect failures, keep
 *     going, report at the end. A 49/50 result with one named failure is
 *     useful; a hard stop at record 3 is not.
 *   - Bound concurrency. The worker autoscales but is not free, and a 50-wide
 *     fan-out will trip rate limits and blow memory on asset-heavy documents.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..", "..", "..");

const DEFAULT_CONCURRENCY = 4;

/* ------------------------------------------------------------------ *
 * Templating
 * ------------------------------------------------------------------ */

/**
 * Fills {{placeholders}} in a doctype template.
 *
 * Deliberately dumb: no logic, no loops, no partials. A template language
 * inside a document template is how content and presentation start leaking
 * into each other again. If a document needs structure the vocabulary does
 * not provide, add a vocabulary term.
 */
export function fillTemplate(template, data) {
  const missing = new Set();
  const filled = template.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, key) => {
    const value = data[key];
    if (value === undefined || value === null || value === "") {
      missing.add(key);
      return "";
    }
    return String(value);
  });
  return { content: filled, missing: [...missing] };
}

/** Lists the doctype templates a brand provides. */
export function listDoctypes(brandId) {
  const dir = path.join(ROOT, "brands", brandId, "doctypes");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.basename(f, ".md"))
    .sort();
}

export function readDoctype(brandId, doctype) {
  const file = path.join(ROOT, "brands", brandId, "doctypes", `${doctype}.md`);
  if (!fs.existsSync(file)) {
    const available = listDoctypes(brandId);
    throw new Error(
      `Unknown doctype '${doctype}' for brand '${brandId}'.` +
      (available.length ? ` Available: ${available.join(", ")}` : " This brand has no doctypes.")
    );
  }
  return fs.readFileSync(file, "utf8");
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/* ------------------------------------------------------------------ *
 * Batch runner
 * ------------------------------------------------------------------ */

/**
 * Produces many documents from one doctype plus an array of records.
 *
 * @param {object} opts
 * @param {string} opts.brand
 * @param {string} opts.doctype
 * @param {Array<object>} opts.records      one document per record
 * @param {function} opts.validate          (absPath) => { ok, errors }
 * @param {function} [opts.render]          async (absPath) => any; omit to skip rendering
 * @param {number}  [opts.concurrency]
 * @param {boolean} [opts.dryRun]           write nothing, still validate
 * @param {function} [opts.onProgress]      ({ index, total, slug, phase, ok })
 */
export async function produceBatch({
  brand,
  doctype,
  records,
  validate,
  render,
  concurrency = DEFAULT_CONCURRENCY,
  dryRun = false,
  onProgress,
}) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("produceBatch needs a non-empty records array");
  }

  const template = readDoctype(brand, doctype);
  const today = new Date().toISOString().slice(0, 10);

  const results = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < records.length) {
      const index = cursor++;
      const record = records[index];

      const slug = record.slug || slugify(record.title || `${doctype}-${index + 1}`);
      const dir = path.join(ROOT, "documents", brand, slug);
      const mdPath = path.join(dir, "doc.md");

      const entry = { index, slug, path: mdPath, ok: false, phase: "template" };

      try {
        const { content, missing } = fillTemplate(template, { date: today, ...record });
        entry.missingPlaceholders = missing;

        if (!dryRun) {
          fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
          fs.writeFileSync(mdPath, content, "utf8");
        } else {
          // Validation needs a real file; use a scratch path outside documents/.
          const tmpDir = path.join(ROOT, ".dryrun", brand, slug);
          fs.mkdirSync(tmpDir, { recursive: true });
          entry.path = path.join(tmpDir, "doc.md");
          fs.writeFileSync(entry.path, content, "utf8");
        }

        entry.phase = "validate";
        onProgress?.({ index, total: records.length, slug, phase: "validate" });

        const v = validate(entry.path);
        if (!v.ok) {
          entry.errors = v.errors;
          results[index] = entry;
          onProgress?.({ index, total: records.length, slug, phase: "validate", ok: false });
          continue;
        }

        if (render && !dryRun) {
          entry.phase = "render";
          onProgress?.({ index, total: records.length, slug, phase: "render" });
          const r = await render(entry.path);
          entry.pdf = r?.pdf ?? r ?? null;
          entry.renderMs = r?.renderMs ?? null;
        }

        entry.ok = true;
        entry.phase = "done";
        results[index] = entry;
        onProgress?.({ index, total: records.length, slug, phase: "done", ok: true });
      } catch (e) {
        // One bad record must not take down the batch.
        entry.errors = [e instanceof Error ? e.message : String(e)];
        results[index] = entry;
        onProgress?.({ index, total: records.length, slug, phase: entry.phase, ok: false });
      }
    }
  };

  const pool = Array.from({ length: Math.min(concurrency, records.length) }, worker);
  await Promise.all(pool);

  const succeeded = results.filter((r) => r?.ok);
  const failed = results.filter((r) => r && !r.ok);

  return {
    total: records.length,
    succeeded: succeeded.length,
    failed: failed.length,
    results,
    failures: failed,
  };
}

/* ------------------------------------------------------------------ *
 * Record loading
 * ------------------------------------------------------------------ */

/** Loads records from JSON (array) or CSV (header row required). */
export function loadRecords(file) {
  const abs = path.resolve(file);
  const raw = fs.readFileSync(abs, "utf8");

  if (abs.endsWith(".json")) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("JSON record file must contain an array of objects");
    }
    return parsed;
  }

  if (abs.endsWith(".csv")) return parseCsv(raw);

  throw new Error(`Unsupported record file '${path.basename(abs)}' — use .json or .csv`);
}

/**
 * Minimal RFC4180-ish CSV parser: quoted fields, escaped quotes, embedded
 * newlines. Enough for hand-maintained data files without adding a dependency.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}
