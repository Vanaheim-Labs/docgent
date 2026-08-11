/**
 * Unified line diff, GitHub-shaped.
 *
 * The semantic differ answers "what changed in document terms". This answers
 * the other question a reviewer asks: "show me the text, exactly, with the
 * lines either side". Both are useful and neither replaces the other, so this
 * lives beside semantic-diff.mjs rather than instead of it.
 *
 * Output is the same shape GitHub renders: hunks of rows, each row carrying a
 * left line number, a right line number and an operation. Changed rows are
 * paired where they plausibly correspond, so a reworded sentence can be marked
 * word-by-word instead of dumped as an unrelated delete and insert.
 */

/* ------------------------------------------------------------------ *
 * Myers diff
 * ------------------------------------------------------------------ */

/**
 * Longest common subsequence over lines, via the classic dynamic-programming
 * table. Documents are thousands of lines at most, so the O(n*m) table is
 * comfortably affordable and avoids the subtle bugs of a hand-rolled Myers
 * implementation. Guard rails below keep pathological inputs from blowing up.
 */
function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;

  // Trim the common prefix and suffix first. Two revisions of a document are
  // usually identical for most of their length, and stripping that collapses
  // the table to the region that actually differs.
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) start++;

  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops = [];
  for (let i = 0; i < start; i++) ops.push({ op: "same", a: i, b: i });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  const mid = diffCore(midA, midB);
  for (const o of mid) {
    ops.push({
      op: o.op,
      a: o.a === -1 ? -1 : o.a + start,
      b: o.b === -1 ? -1 : o.b + start,
    });
  }

  for (let i = 0; i < n - endA; i++) {
    ops.push({ op: "same", a: endA + i, b: endB + i });
  }

  return ops;
}

/**
 * The DP core, run only on the region that differs.
 *
 * Falls back to a naive replace-everything when the region is enormous, since
 * a 10k x 10k table is 100M cells and no reviewer benefits from a diff that
 * large anyway.
 */
function diffCore(a, b) {
  const n = a.length;
  const m = b.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((_, j) => ({ op: "add", a: -1, b: j }));
  if (m === 0) return a.map((_, i) => ({ op: "remove", a: i, b: -1 }));

  if (n * m > 4_000_000) {
    return [
      ...a.map((_, i) => ({ op: "remove", a: i, b: -1 })),
      ...b.map((_, j) => ({ op: "add", a: -1, b: j })),
    ];
  }

  // table[i][j] = LCS length of a[i..] and b[j..]
  const table = new Array(n + 1);
  for (let i = 0; i <= n; i++) table[i] = new Uint32Array(m + 1);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: "same", a: i, b: j });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ op: "remove", a: i, b: -1 });
      i++;
    } else {
      ops.push({ op: "add", a: -1, b: j });
      j++;
    }
  }
  while (i < n) ops.push({ op: "remove", a: i++, b: -1 });
  while (j < m) ops.push({ op: "add", a: -1, b: j++ });

  return ops;
}

/* ------------------------------------------------------------------ *
 * Word-level refinement
 * ------------------------------------------------------------------ */

/** Split retaining whitespace, so reconstructed text keeps its spacing. */
function tokenise(line) {
  return line.match(/\s+|[^\s]+/g) || [];
}

/**
 * Similarity of two lines, 0..1, by shared token multiset.
 *
 * Used to decide whether a removal and an addition are a rewrite of the same
 * line (worth marking word-by-word) or two unrelated lines that happen to sit
 * next to each other.
 */
function similarity(x, y) {
  const ax = tokenise(x).filter((t) => t.trim());
  const ay = tokenise(y).filter((t) => t.trim());
  if (!ax.length && !ay.length) return 1;
  if (!ax.length || !ay.length) return 0;

  const counts = new Map();
  for (const t of ax) counts.set(t, (counts.get(t) || 0) + 1);

  let shared = 0;
  for (const t of ay) {
    const c = counts.get(t) || 0;
    if (c > 0) {
      shared++;
      counts.set(t, c - 1);
    }
  }
  return (2 * shared) / (ax.length + ay.length);
}

/** Word-level runs for a pair of corresponding lines. */
function wordDiff(before, after) {
  const a = tokenise(before);
  const b = tokenise(after);
  const ops = lcsOps(a, b);

  const left = [];
  const right = [];
  for (const o of ops) {
    if (o.op === "same") {
      push(left, "same", a[o.a]);
      push(right, "same", b[o.b]);
    } else if (o.op === "remove") {
      push(left, "remove", a[o.a]);
    } else {
      push(right, "add", b[o.b]);
    }
  }
  return { left, right };
}

/** Coalesce adjacent runs of the same op so the DOM stays small. */
function push(runs, op, text) {
  if (text === undefined) return;
  const last = runs[runs.length - 1];
  if (last && last.op === op) last.text += text;
  else runs.push({ op, text });
}

/* ------------------------------------------------------------------ *
 * Hunks
 * ------------------------------------------------------------------ */

/**
 * Groups rows into hunks with N lines of context, the way `git diff -U` does.
 * Everything outside a hunk is collapsed, because a reviewer scanning a
 * hundred-page document should not scroll through the ninety-nine unchanged
 * pages to reach the edit.
 */
function buildHunks(rows, context) {
  const changed = rows.map((r) => r.op !== "same");
  if (!changed.some(Boolean)) return [];

  const keep = new Array(rows.length).fill(false);
  for (let i = 0; i < rows.length; i++) {
    if (!changed[i]) continue;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) {
      keep[j] = true;
    }
  }

  const hunks = [];
  let i = 0;
  while (i < rows.length) {
    if (!keep[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && keep[j]) j++;

    const slice = rows.slice(i, j);
    const firstLeft = slice.find((r) => r.leftNo != null);
    const firstRight = slice.find((r) => r.rightNo != null);
    const leftCount = slice.filter((r) => r.leftNo != null).length;
    const rightCount = slice.filter((r) => r.rightNo != null).length;

    hunks.push({
      leftStart: firstLeft ? firstLeft.leftNo : 0,
      leftCount,
      rightStart: firstRight ? firstRight.rightNo : 0,
      rightCount,
      /** Lines hidden before this hunk; drives the "expand" affordance. */
      skippedBefore: i - (hunks.length ? hunks[hunks.length - 1].endIndex : 0),
      startIndex: i,
      endIndex: j,
      /** Nearest preceding heading, so a hunk header names its section. */
      heading: nearestHeading(rows, i),
      rows: slice,
    });
    i = j;
  }
  return hunks;
}

/**
 * The section a hunk sits in.
 *
 * GitHub shows the enclosing function here. For a document the equivalent is
 * the enclosing heading, which is far more use to a reviewer than a line range.
 */
function nearestHeading(rows, index) {
  for (let i = index; i >= 0; i--) {
    const text = rows[i].rightText ?? rows[i].leftText ?? "";
    const m = text.match(/^(#{1,6})\s+(.*)$/);
    if (m) return m[2].trim();
  }
  return "";
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Unified diff between two revisions of a document.
 *
 * @param {string} before
 * @param {string} after
 * @param {{ context?: number }} [opts]
 */
export function unifiedDiff(before, after, opts = {}) {
  const context = opts.context ?? 3;

  const a = String(before ?? "").split(/\r?\n/);
  const b = String(after ?? "").split(/\r?\n/);

  const ops = lcsOps(a, b);

  /*
   * Pair each removal with the addition it most likely became.
   *
   * The LCS walk emits removals and additions as separate runs. Left as-is a
   * reworded sentence renders as a red line and an unrelated-looking green
   * line. Pairing them within a run, when they are similar enough, is what
   * lets the word-level marking work.
   */
  const rows = [];
  let leftNo = 0;
  let rightNo = 0;

  let k = 0;
  while (k < ops.length) {
    const o = ops[k];

    if (o.op === "same") {
      leftNo++;
      rightNo++;
      rows.push({
        op: "same",
        leftNo,
        rightNo,
        leftText: a[o.a],
        rightText: b[o.b],
      });
      k++;
      continue;
    }

    // Collect the contiguous run of changes.
    const removals = [];
    const additions = [];
    while (k < ops.length && ops[k].op !== "same") {
      if (ops[k].op === "remove") removals.push(a[ops[k].a]);
      else additions.push(b[ops[k].b]);
      k++;
    }

    const pairs = Math.min(removals.length, additions.length);
    for (let p = 0; p < pairs; p++) {
      const from = removals[p];
      const to = additions[p];
      leftNo++;
      rightNo++;

      // Only mark words when the lines are recognisably the same line. Below
      // the threshold, word marking produces confetti rather than insight.
      const sim = similarity(from, to);
      if (sim >= 0.35) {
        const { left, right } = wordDiff(from, to);
        rows.push({
          op: "change",
          leftNo,
          rightNo,
          leftText: from,
          rightText: to,
          leftWords: left,
          rightWords: right,
        });
      } else {
        rows.push({ op: "remove", leftNo, rightNo: null, leftText: from });
        rows.push({ op: "add", leftNo: null, rightNo, rightText: to });
      }
    }

    for (let p = pairs; p < removals.length; p++) {
      leftNo++;
      rows.push({ op: "remove", leftNo, rightNo: null, leftText: removals[p] });
    }
    for (let p = pairs; p < additions.length; p++) {
      rightNo++;
      rows.push({ op: "add", leftNo: null, rightNo, rightText: additions[p] });
    }
  }

  const hunks = buildHunks(rows, context);

  let additionsCount = 0;
  let deletionsCount = 0;
  for (const r of rows) {
    if (r.op === "add") additionsCount++;
    else if (r.op === "remove") deletionsCount++;
    else if (r.op === "change") {
      additionsCount++;
      deletionsCount++;
    }
  }

  return {
    additions: additionsCount,
    deletions: deletionsCount,
    totalLines: rows.length,
    hunks,
    /** Retained so the client can expand context without a round trip. */
    rows,
  };
}
