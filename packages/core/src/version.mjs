/**
 * Document version arithmetic.
 *
 * A document carries two independent numbers. `version:` in the frontmatter is
 * authored, and is what the document calls itself on its cover. The revision
 * count in Studio's history panel is derived from git and counts commits
 * touching the path. Nothing keeps them in sync, and they should not be
 * conflated.
 *
 * The invariant this module exists to protect is on the frontmatter version:
 * it must rise monotonically, so that the highest version is always the most
 * recent issue of the document. Agents and readers resolve "the current
 * version" by picking the largest number; that only works if nothing ever
 * reissues or lowers one.
 *
 * A verbatim restore is the one operation that breaks this naturally. Copying
 * an old blob forward copies its old version with it, so the newest commit
 * ends up carrying a lower version than an earlier one. Hence `nextVersion`,
 * which advances past the high-water mark rather than past the current value.
 */

/**
 * Parses a version string into comparable numeric parts.
 *
 * History contains both two- and three-part forms ("14.0" alongside "8.0.0"),
 * so parts are compared positionally with missing trailing parts treated as
 * zero. That makes 8.0 and 8.0.0 equal, which is the intent: they are the same
 * version written two ways, not two different versions.
 *
 * Returns null for anything unparseable rather than guessing. Callers treat
 * null as "no usable version" and fall back rather than inventing one.
 */
export function parseVersion(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/^v/i, "");
  if (!text) return null;
  // Leading numeric run only: "1.2.3-draft" compares as 1.2.3, and any
  // trailing label is ignored rather than making the version unparseable.
  const m = text.match(/^(\d+(?:\.\d+)*)/);
  if (!m) return null;
  const parts = m[1].split(".").map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
}

/**
 * Compares two version strings. Returns >0 if a is higher, <0 if b is higher,
 * 0 if equal or if neither parses. Unparseable sorts below anything parseable.
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The highest version among the given values ("high-water mark").
 *
 * Deliberately not "the version at HEAD". A document that reached 14.0 and was
 * then restored back to 12.0 has a HEAD of 12.0 but a high-water mark of 14.0;
 * bumping from HEAD would reissue 13.0, a number already spent on different
 * content. Returns null when nothing parses.
 */
export function highWaterVersion(values) {
  let best = null;
  for (const v of values ?? []) {
    if (parseVersion(v) === null) continue;
    if (best === null || compareVersions(v, best) > 0) best = String(v).trim();
  }
  return best;
}

/**
 * The next version after a set of already-issued versions.
 *
 * Bumps the major part and zeroes the rest, matching the existing convention
 * where documents move 11.0 -> 12.0 -> 14.0 rather than by minor increments.
 * Width is preserved, so a 3-part history keeps producing 3-part versions.
 *
 * Gaps are expected and harmless: skipping a burned number is the price of
 * never reusing one. With no parseable history, starts at "1.0".
 */
export function nextVersion(existing) {
  const high = highWaterVersion(existing);
  const parts = parseVersion(high);
  if (!parts) return "1.0";
  const width = Math.max(parts.length, 2);
  const bumped = [parts[0] + 1, ...Array(width - 1).fill(0)];
  return bumped.join(".");
}

/**
 * Rewrites the `version:` key inside a frontmatter block, preserving the rest
 * of the document byte-for-byte.
 *
 * String surgery rather than a YAML round-trip: reserialising would reorder
 * keys, drop comments and normalise quoting across the whole block, producing
 * a diff far larger than the one line that actually changed. Documents without
 * frontmatter are returned unchanged, since there is nothing to key off.
 */
export function setFrontmatterVersion(src, version) {
  const m = src.match(/^(---\n)([\s\S]*?)(\n---\n)/);
  if (!m) return src;
  const [full, open, body, close] = m;
  // Match the quoting style already in use so the diff stays to the value.
  const existing = body.match(/^version:\s*(.*)$/m);
  const quoted = existing ? /^\s*["']/.test(existing[1]) : true;
  const rendered = quoted ? `"${version}"` : version;
  const line = `version: ${rendered}`;
  const nextBody = existing
    ? body.replace(/^version:\s*.*$/m, line)
    : `${body}\n${line}`;
  return open + nextBody + close + src.slice(full.length);
}
