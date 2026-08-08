#!/usr/bin/env node
/**
 * Semantic diff tests.
 *
 * The point of this layer is that a reviewer sees document-level changes, not
 * markdown noise. These tests pin that behaviour: rewrapping prose must not
 * register as a change, while a changed keyfigure value must.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { semanticDiff, outline, summarise, parseFrontmatter } from "../src/semantic-diff.mjs";

const doc = (body, fm = {}) => {
  const front = {
    title: "T", brand: "vanaheim", doctype: "Report",
    version: "1.0.0", date: "2026-08-01", ...fm,
  };
  const lines = Object.entries(front).map(([k, v]) => `${k}: "${v}"`).join("\n");
  return `---\n${lines}\n---\n\n${body}\n`;
};

/* ---------------- parsing ---------------- */

test("outline captures headings, blocks and prose", () => {
  const nodes = outline(doc([
    "# Introduction",
    "",
    "Some body copy here.",
    "",
    "::: {.callout kind=warning title=\"Risk\"}",
    "Watch out.",
    ":::",
  ].join("\n")));

  assert.equal(nodes.filter((n) => n.kind === "heading").length, 1);
  assert.equal(nodes.filter((n) => n.kind === "block").length, 1);
  const block = nodes.find((n) => n.kind === "block");
  assert.equal(block.id, "callout");
  assert.equal(block.attrs.kind, "warning");
  assert.equal(block.section, "Introduction");
});

test("parseFrontmatter reads scalars", () => {
  const fm = parseFrontmatter(doc("# X", { status: "draft" }));
  assert.equal(fm.status, "draft");
  assert.equal(fm.brand, "vanaheim");
});

/* ---------------- the core promise ---------------- */

test("rewrapping prose is not reported as a change", () => {
  const a = doc("# S\n\nThe quick brown fox jumps over the lazy dog and keeps running.");
  const b = doc("# S\n\nThe quick brown fox jumps over\nthe lazy dog and keeps running.");
  const d = semanticDiff(a, b);
  assert.equal(d.summary.total, 0, JSON.stringify(d.changes));
});

test("changed keyfigure value is reported as an attribute change", () => {
  const a = doc('::: {.keyfigure value="$4.2M" label="Run rate"}\nContext.\n:::');
  const b = doc('::: {.keyfigure value="$4.8M" label="Run rate"}\nContext.\n:::');
  const d = semanticDiff(a, b);
  const change = d.changes.find((c) => c.type === "attribute_changed");
  assert.ok(change, JSON.stringify(d.changes));
  assert.equal(change.key, "value");
  assert.equal(change.before, "$4.2M");
  assert.equal(change.after, "$4.8M");
});

test("added block is reported with its section", () => {
  const a = doc("# Findings\n\nBody.");
  const b = doc("# Findings\n\nBody.\n\n::: {.callout kind=risk title=\"New\"}\nProblem.\n:::");
  const d = semanticDiff(a, b);
  const added = d.changes.find((c) => c.type === "block_added");
  assert.ok(added);
  assert.equal(added.block, "callout");
  assert.equal(added.section, "Findings");
});

test("removed recommendation is tracked by its ref", () => {
  const a = doc([
    '::: {.recommendation ref="R1" priority=high}',
    "Do this.",
    ":::",
    "",
    '::: {.recommendation ref="R2" priority=medium}',
    "Do that.",
    ":::",
  ].join("\n"));
  const b = doc([
    '::: {.recommendation ref="R1" priority=high}',
    "Do this.",
    ":::",
  ].join("\n"));
  const d = semanticDiff(a, b);
  const removed = d.changes.find((c) => c.type === "block_removed");
  assert.ok(removed);
  assert.match(removed.detail, /R2/);
});

test("recommendation priority change is surfaced", () => {
  const a = doc('::: {.recommendation ref="R1" priority=medium}\nX.\n:::');
  const b = doc('::: {.recommendation ref="R1" priority=critical}\nX.\n:::');
  const d = semanticDiff(a, b);
  const c = d.changes.find((x) => x.type === "attribute_changed" && x.key === "priority");
  assert.ok(c);
  assert.equal(c.after, "critical");
});

test("block body edit is distinguished from attribute change", () => {
  const a = doc('::: {.callout kind=note title="T"}\nOriginal text.\n:::');
  const b = doc('::: {.callout kind=note title="T"}\nCompletely different text.\n:::');
  const d = semanticDiff(a, b);
  assert.ok(d.changes.some((c) => c.type === "block_edited"));
  assert.ok(!d.changes.some((c) => c.type === "attribute_changed"));
});

test("frontmatter status transition is reported", () => {
  const a = doc("# X", { status: "draft" });
  const b = doc("# X", { status: "approved" });
  const d = semanticDiff(a, b);
  const c = d.changes.find((x) => x.type === "metadata_changed");
  assert.equal(c.key, "status");
  assert.equal(c.before, "draft");
  assert.equal(c.after, "approved");
});

test("section add and remove are reported", () => {
  const a = doc("# One\n\nBody one.");
  const b = doc("# One\n\nBody one.\n\n# Two\n\nBody two.");
  const d = semanticDiff(a, b);
  assert.ok(d.changes.some((c) => c.type === "section_added" && c.section === "Two"));

  const back = semanticDiff(b, a);
  assert.ok(back.changes.some((c) => c.type === "section_removed" && c.section === "Two"));
});

test("identical documents produce no changes", () => {
  const a = doc("# S\n\nBody.\n\n::: {.callout kind=note}\nX.\n:::");
  const d = semanticDiff(a, a);
  assert.equal(d.summary.total, 0);
});

test("summarise renders a readable one-liner", () => {
  const a = doc('# S\n\nBody.\n\n::: {.keyfigure value="1" label="L"}\nX.\n:::');
  const b = doc('# S\n\nBody changed here.\n\n::: {.keyfigure value="2" label="L"}\nX.\n:::');
  const d = semanticDiff(a, b);
  const s = summarise(d);
  assert.match(s, /value changed/);
  assert.equal(summarise(semanticDiff(a, a)), "No structural changes");
});
